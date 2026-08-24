import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  Html5QrcodeScanner
} from "html5-qrcode";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001";

function makeWsBase() {
  const url = new URL(API_BASE);

  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : "ws:";

  url.pathname = "/ws";

  return url.toString();
}

const WS_BASE = makeWsBase();

const MODES = [
  [1, "FIRE", "orange"],
  [2, "ZEN", "cyan"],
  [3, "WARM", "warm"],
  [4, "COOL", "cool"],
  [5, "GOLD", "gold"],
  [10, "LAVA", "lava"],
  [7, "PURPLE", "purple"],
  [9, "FOREST", "forest"],
  [8, "SUNSET", "sunset"],
  [11, "OCEAN", "ocean"],
  [6, "DEEP", "deep"],
  [12, "PARTY", "party"]
];

function cleanDeviceId(value) {
  return String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
}

function cToF(c) {
  const n = Number(c);

  if (!Number.isFinite(n)) {
    return "--";
  }

  return (n * 1.8 + 32).toFixed(1);
}

function timerDisplay(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }

  return Math.ceil(n);
}

function getDeviceIdFromText(text = "") {
  const raw = String(text || "").trim();

  try {
    const url = new URL(raw);

    return cleanDeviceId(
      url.searchParams.get("device")
    );
  } catch {}

  const params =
    new URLSearchParams(
      window.location.search
    );

  const fromUrl =
    cleanDeviceId(
      params.get("device")
    );

  if (fromUrl.length === 12) {
    return fromUrl;
  }

  return cleanDeviceId(raw);
}

function boolFromStatus(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true" ||
    value === "on"
  );
}

export default function App() {

  const urlDeviceId =
    cleanDeviceId(
      new URLSearchParams(
        window.location.search
      ).get("device")
    );

  const initialDeviceId =
    urlDeviceId.length === 12
      ? urlDeviceId
      : localStorage.getItem(
          "saunaDeviceId"
        ) || "";

  const [showQr, setShowQr] =
    useState(false);

  const [deviceId, setDeviceId] =
    useState(initialDeviceId);

  const [entryId, setEntryId] =
    useState(initialDeviceId);

  const [status, setStatus] =
    useState({
      t: 120,
      tm: 0,
      itm: 0,
      b: 150,
      mode: 1,
      lon: true,
      rm: 3,

      // Aromatherapy
      af: 1,
      aen: false,
      ap: 60,
      steam: false,
      apump: false,
      amanual: false,
      aromaUI: false,

      // NEW SETTINGS
      reverseRooms: false,
      infraredUI: true,

      // LED installation
      ledTotal: 600,
      r1Start: 3,
      r1End: 272,
      r2Start: 300,
      r2End: 599
    });

  const [
    backendOnline,
    setBackendOnline
  ] = useState(false);

  const [
    wsOnline,
    setWsOnline
  ] = useState(false);

  const [error, setError] =
    useState("");

  const [view, setView] =
    useState("main");

  const [
    settingsPassword,
    setSettingsPassword
  ] = useState("");

  const [
    settingsMessage,
    setSettingsMessage
  ] = useState("");

  const [
    settingsSaving,
    setSettingsSaving
  ] = useState(false);

  const [
    settingsForm,
    setSettingsForm
  ] = useState({
    newPassword: "",
    aromaUI: false,

    // NEW SETTINGS
    reverseRooms: false,
    infraredUI: true,

    ledTotal: 600,
    r1Start: 3,
    r1End: 272,
    r2Start: 300,
    r2End: 599
  });

  const wsRef = useRef(null);

  const primeActiveRef =
    useRef(false);

  const connectedText =
    useMemo(() => {
      if (!backendOnline) {
        return "BACKEND OFFLINE";
      }

      if (!wsOnline) {
        return "WAITING FOR LIVE STATUS";
      }

      return "REMOTE MQTT LINK ACTIVE";
    }, [
      backendOnline,
      wsOnline
    ]);

  // =========================================================
  // DEVICE ID STORAGE
  // =========================================================

  useEffect(() => {
    if (
      deviceId &&
      deviceId.length === 12
    ) {
      localStorage.setItem(
        "saunaDeviceId",
        deviceId
      );
    }
  }, [deviceId]);

  // =========================================================
  // BACKEND HEALTH
  // =========================================================

  useEffect(() => {
    fetch(
      `${API_BASE}/api/health`
    )
      .then((r) => r.json())
      .then((d) =>
        setBackendOnline(
          Boolean(d.ok)
        )
      )
      .catch(() =>
        setBackendOnline(false)
      );
  }, []);

  // =========================================================
  // QR SCANNER
  // =========================================================

  useEffect(() => {
    if (!showQr) {
      return;
    }

    const scanner =
      new Html5QrcodeScanner(
        "qr-reader",
        {
          fps: 10,
          qrbox: 250
        },
        false
      );

    scanner.render(
      (decodedText) => {
        const cleaned =
          getDeviceIdFromText(
            decodedText
          );

        if (cleaned.length === 12) {
          setEntryId(cleaned);

          localStorage.setItem(
            "saunaDeviceId",
            cleaned
          );

          setDeviceId(cleaned);
          setShowQr(false);

          scanner.clear();
        } else {
          setError(
            "QR code did not contain a valid 12-character Device ID."
          );
        }
      },

      () => {}
    );

    return () => {
      scanner
        .clear()
        .catch(() => {});
    };
  }, [showQr]);

  // =========================================================
  // STATUS + WEBSOCKET
  // =========================================================

  useEffect(() => {
    if (!deviceId) {
      return;
    }

    let stopped = false;

    fetch(
      `${API_BASE}/api/device/${deviceId}/status`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d) {
          setStatus(
            (prev) => ({
              ...prev,
              ...d
            })
          );
        }
      })
      .catch(() => {});

    function connectWs() {
      if (stopped) {
        return;
      }

      const ws =
        new WebSocket(
          `${WS_BASE}?deviceId=${deviceId}`
        );

      wsRef.current = ws;

      ws.onopen = () => {
        setWsOnline(true);
        setError("");

        ws.send(
          JSON.stringify({
            type: "subscribe",
            deviceId
          })
        );
      };

      ws.onmessage =
        (event) => {
          try {
            const msg =
              JSON.parse(
                event.data
              );

            if (
              msg.type === "status"
            ) {
              setStatus(
                (prev) => ({
                  ...prev,
                  ...msg.status
                })
              );
            }

            if (
              msg.type === "error"
            ) {
              setError(msg.error);
            }
          } catch {}
        };

      ws.onclose = () => {
        setWsOnline(false);

        if (!stopped) {
          setTimeout(
            connectWs,
            3000
          );
        }
      };

      ws.onerror = () => {
        setWsOnline(false);
      };
    }

    connectWs();

    return () => {
      stopped = true;
      wsRef.current?.close();
    };
  }, [deviceId]);

  // =========================================================
  // TIMER COUNTDOWN
  // =========================================================

  useEffect(() => {
    const interval =
      setInterval(() => {
        setStatus(
          (prev) => {
            const next = {
              ...prev
            };

            if (
              next.on &&
              Number(next.tm) > 0
            ) {
              next.tm =
                Math.max(
                  0,
                  Number(next.tm) -
                    1 / 60
                );
            }

            if (
              Number(next.itm) > 0
            ) {
              next.itm =
                Math.max(
                  0,
                  Number(next.itm) -
                    1 / 60
                );

              next.iron =
                next.itm > 0;
            }

            return next;
          }
        );
      }, 1000);

    return () =>
      clearInterval(interval);
  }, []);

  // =========================================================
  // DEVICE
  // =========================================================

  function saveDeviceId() {
    const cleaned =
      cleanDeviceId(entryId);

    if (cleaned.length !== 12) {
      setError(
        "Device ID must be 12 hex characters, like A0B76314F23C."
      );

      return;
    }

    localStorage.setItem(
      "saunaDeviceId",
      cleaned
    );

    setDeviceId(cleaned);
    setError("");
  }

  function changeDevice() {
    stopPrime();

    localStorage.removeItem(
      "saunaDeviceId"
    );

    setDeviceId("");
    setEntryId("");
    setView("main");

    setSettingsPassword("");

    setStatus({
      t: 120,
      tm: 0,
      itm: 0,
      b: 150,
      mode: 1,
      lon: true,
      rm: 3,

      af: 1,
      aen: false,
      ap: 60,
      steam: false,
      apump: false,
      amanual: false,
      aromaUI: false,

      reverseRooms: false,
      infraredUI: true,

      ledTotal: 600,
      r1Start: 3,
      r1End: 272,
      r2Start: 300,
      r2End: 599
    });
  }

  // =========================================================
  // COMMAND
  // =========================================================

  async function cmd(
    command,
    value,
    optimistic = null
  ) {
    if (optimistic) {
      setStatus(
        (prev) => ({
          ...prev,
          ...optimistic
        })
      );
    }

    try {
      const r =
        await fetch(
          `${API_BASE}/api/device/${deviceId}/cmd/${command}`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                value
              })
          }
        );

      const data =
        await r.json();

      if (!r.ok) {
        throw new Error(
          data.error ||
            "Command failed"
        );
      }

      setError("");

      return true;
    } catch (e) {
      setError(
        e.message ||
          "Command failed"
      );

      return false;
    }
  }

  // =========================================================
  // ROOM
  // =========================================================

  function selectedRoom() {
    const rm =
      Number(status.rm ?? 3);

    return (
      rm >= 1 &&
      rm <= 3
    )
      ? rm
      : 3;
  }

  // IMPORTANT:
  // Physical Room 1 and Room 2 do NOT change.
  // Only their displayed names change.

  function roomOptions() {
    const reversed =
      boolFromStatus(
        status.reverseRooms
      );

    return [
      [
        1,
        reversed
          ? "STEAM R"
          : "SAUNA"
      ],
      [
        2,
        reversed
          ? "SAUNA"
          : "STEAM R"
      ],
      [3, "BOTH R"]
    ];
  }

  function roomLabel() {
    const rm = selectedRoom();

    return (
      roomOptions().find(
        ([id]) => id === rm
      )?.[1] ||
      "BOTH R"
    );
  }

  // =========================================================
  // PRIME
  // =========================================================

  function startPrime() {
    if (
      primeActiveRef.current
    ) {
      return;
    }

    primeActiveRef.current = true;

    setStatus(
      (prev) => ({
        ...prev,
        amanual: true,
        apump: true
      })
    );

    cmd(
      "aroma-manual",
      "on"
    );
  }

  function stopPrime() {
    if (
      !primeActiveRef.current
    ) {
      return;
    }

    primeActiveRef.current = false;

    setStatus(
      (prev) => ({
        ...prev,
        amanual: false,
        apump: false
      })
    );

    if (deviceId) {
      cmd(
        "aroma-manual",
        "off"
      );
    }
  }

  // =========================================================
  // OPEN SETTINGS
  // =========================================================

  async function openSettings() {

    const password =
      window.prompt(
        "Enter settings password:"
      );

    if (password === null) {
      return;
    }

    const cleanPassword =
      password.trim();

    if (!cleanPassword) {
      setError(
        "Settings password is required."
      );

      return;
    }

    setError("");

    try {
      const r =
        await fetch(
          `${API_BASE}/api/device/${deviceId}/settings/verify`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                password:
                  cleanPassword
              })
          }
        );

      const data =
        await r.json();

      if (!r.ok) {
        throw new Error(
          data.error ||
            "Unable to verify settings password"
        );
      }

      setSettingsPassword(
        cleanPassword
      );

      setSettingsForm({
        newPassword: "",

        aromaUI:
          boolFromStatus(
            status.aromaUI
          ),

        reverseRooms:
          boolFromStatus(
            status.reverseRooms
          ),

        infraredUI:
          status.infraredUI ===
          undefined
            ? true
            : boolFromStatus(
                status.infraredUI
              ),

        ledTotal:
          Number(
            status.ledTotal ??
              600
          ),

        r1Start:
          Number(
            status.r1Start ??
              3
          ),

        r1End:
          Number(
            status.r1End ??
              272
          ),

        r2Start:
          Number(
            status.r2Start ??
              300
          ),

        r2End:
          Number(
            status.r2End ??
              599
          )
      });

      setSettingsMessage("");
      setView("settings");

    } catch (e) {
      setError(
        e.message ||
          "Unable to verify settings password"
      );
    }
  }

  function updateSetting(
    name,
    value
  ) {
    setSettingsForm(
      (prev) => ({
        ...prev,
        [name]: value
      })
    );
  }

  function validateSettingsForm() {

    const ledTotal =
      Number(
        settingsForm.ledTotal
      );

    const r1Start =
      Number(
        settingsForm.r1Start
      );

    const r1End =
      Number(
        settingsForm.r1End
      );

    const r2Start =
      Number(
        settingsForm.r2Start
      );

    const r2End =
      Number(
        settingsForm.r2End
      );

    if (
      !Number.isInteger(
        ledTotal
      ) ||
      !Number.isInteger(
        r1Start
      ) ||
      !Number.isInteger(
        r1End
      ) ||
      !Number.isInteger(
        r2Start
      ) ||
      !Number.isInteger(
        r2End
      )
    ) {
      return (
        "LED settings must be whole numbers."
      );
    }

    if (
      ledTotal < 1 ||
      ledTotal > 5000
    ) {
      return (
        "Total LEDs must be between 1 and 5000."
      );
    }

    if (
      r1Start < 0 ||
      r1End < r1Start ||
      r1End >= ledTotal
    ) {
      return (
        "Invalid Sauna LED range."
      );
    }

    if (
      r2Start < 0 ||
      r2End < r2Start ||
      r2End >= ledTotal
    ) {
      return (
        "Invalid Steam LED range."
      );
    }

    return "";
  }

  // =========================================================
  // SAVE SETTINGS
  // =========================================================

  async function saveSettings() {

    const validationError =
      validateSettingsForm();

    if (validationError) {
      setSettingsMessage(
        validationError
      );

      return;
    }

    setSettingsSaving(true);
    setSettingsMessage("");

    const payload = {
      password:
        settingsPassword,

      newPassword:
        settingsForm
          .newPassword
          .trim(),

      aromaUI:
        Boolean(
          settingsForm.aromaUI
        ),

      // NEW
      reverseRooms:
        Boolean(
          settingsForm
            .reverseRooms
        ),

      // NEW
      infraredUI:
        Boolean(
          settingsForm
            .infraredUI
        ),

      ledTotal:
        Number(
          settingsForm.ledTotal
        ),

      r1Start:
        Number(
          settingsForm.r1Start
        ),

      r1End:
        Number(
          settingsForm.r1End
        ),

      r2Start:
        Number(
          settingsForm.r2Start
        ),

      r2End:
        Number(
          settingsForm.r2End
        )
    };

    try {
      const r =
        await fetch(
          `${API_BASE}/api/device/${deviceId}/settings`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const data =
        await r.json();

      if (!r.ok) {
        throw new Error(
          data.error ||
            "Unable to save settings"
        );
      }

      setStatus(
        (prev) => ({
          ...prev,

          aromaUI:
            payload.aromaUI,

          reverseRooms:
            payload.reverseRooms,

          infraredUI:
            payload.infraredUI,

          ledTotal:
            payload.ledTotal,

          r1Start:
            payload.r1Start,

          r1End:
            payload.r1End,

          r2Start:
            payload.r2Start,

          r2End:
            payload.r2End
        })
      );

      if (
        payload.newPassword
      ) {
        setSettingsPassword(
          payload.newPassword
        );
      }

      setSettingsForm(
        (prev) => ({
          ...prev,
          newPassword: ""
        })
      );

      setSettingsMessage(
        "Settings sent to controller."
      );

    } catch (e) {

      setSettingsMessage(
        e.message ||
          "Unable to save settings"
      );

    } finally {
      setSettingsSaving(false);
    }
  }

  // =========================================================
  // DEVICE LOGIN PAGE
  // =========================================================

  if (!deviceId) {
    return (
      <div className="page setupPage">

        <div className="panel setupPanel">

          <div className="brand">
            GEYSERSTEAM
          </div>

          <h1>
            Sauna Remote
          </h1>

          <p>
            Enter your sauna Device ID
            to continue.
          </p>

          <input
            className="deviceInput"

            value={entryId}

            onChange={(e) =>
              setEntryId(
                cleanDeviceId(
                  e.target.value
                )
              )
            }

            placeholder=
              "A0B76314F23C"
          />

          <button
            className=
              "primary fullBtn"

            onClick={
              saveDeviceId
            }
          >
            CONNECT
          </button>

          <button
            className=
              "secondary fullBtn"

            onClick={() =>
              setShowQr(true)
            }
          >
            SCAN QR CODE
          </button>

          {showQr && (
            <div className="qrPanel">

              <div
                id="qr-reader"
              />

              <button
                className="smallBtn"

                onClick={() =>
                  setShowQr(false)
                }
              >
                Cancel
              </button>

            </div>
          )}

          {error && (
            <div className="error">
              {error}
            </div>
          )}

        </div>

      </div>
    );
  }

  // =========================================================
  // SETTINGS PAGE
  // =========================================================

  if (view === "settings") {
    return (
      <div className="page">

        <div className="appShell">

          <div className="topLine">

            <div>

              <div className="brand">
                GEYSERSTEAM
              </div>

              <h1>
                Settings
              </h1>

            </div>

            <button
              className="smallBtn"

              onClick={() => {
                setView("main");
                setSettingsMessage("");
              }}
            >
              Back
            </button>

          </div>

          <div
            className={
              backendOnline &&
              wsOnline
                ? "link good"
                : "link bad"
            }
          >
            {connectedText}
          </div>

          {/* SECURITY */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="Security"
            />

            <label
              className=
                "settingsLabel"
            >
              Change default password
            </label>

            <input
              className=
                "settingsInput"

              type="password"

              value={
                settingsForm
                  .newPassword
              }

              onChange={(e) =>
                updateSetting(
                  "newPassword",
                  e.target.value
                )
              }

              placeholder=
                "Leave blank to keep current password"
            />

            <div
              className=
                "settingsHelp"
            >
              The master password
              remains available even
              if the default password
              is changed.
            </div>

          </section>

          {/* AROMATHERAPY */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="Aromatherapy"
            />

            <label
              className="switchRow"
            >

              <div>

                <strong>
                  Enable aromatherapy
                  controls
                </strong>

                <div
                  className=
                    "settingsHelp"
                >
                  Show aromatherapy
                  controls on the main
                  page when the hardware
                  is installed.
                </div>

              </div>

              <input
                type="checkbox"

                checked={
                  Boolean(
                    settingsForm
                      .aromaUI
                  )
                }

                onChange={(e) =>
                  updateSetting(
                    "aromaUI",
                    e.target.checked
                  )
                }
              />

            </label>

          </section>

          {/* ROOM NAMES */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="Rooms"
            />

            <label
              className="switchRow"
            >

              <div>

                <strong>
                  Reverse Sauna / Steam
                  room names
                </strong>

                <div
                  className=
                    "settingsHelp"
                >
                  Only changes the
                  displayed names.
                  Physical Room 1 and
                  Room 2 wiring remain
                  unchanged.
                </div>

              </div>

              <input
                type="checkbox"

                checked={
                  Boolean(
                    settingsForm
                      .reverseRooms
                  )
                }

                onChange={(e) =>
                  updateSetting(
                    "reverseRooms",
                    e.target.checked
                  )
                }
              />

            </label>

          </section>

          {/* INFRARED */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="Infrared"
            />

            <label
              className="switchRow"
            >

              <div>

                <strong>
                  Enable infrared
                  controls
                </strong>

                <div
                  className=
                    "settingsHelp"
                >
                  Hide the infrared
                  controls when the
                  cabin does not include
                  infrared.
                </div>

              </div>

              <input
                type="checkbox"

                checked={
                  Boolean(
                    settingsForm
                      .infraredUI
                  )
                }

                onChange={(e) =>
                  updateSetting(
                    "infraredUI",
                    e.target.checked
                  )
                }
              />

            </label>

          </section>

          {/* LED SETTINGS */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="LED Installation"
            />

            <label
              className=
                "settingsLabel"
            >
              Total physical LEDs
            </label>

            <input
              className=
                "settingsInput"

              type="number"

              min="1"
              max="5000"

              value={
                settingsForm
                  .ledTotal
              }

              onChange={(e) =>
                updateSetting(
                  "ledTotal",
                  Number(
                    e.target.value
                  )
                )
              }
            />

            <div
              className=
                "settingsGrid"
            >

              <div>

                <label
                  className=
                    "settingsLabel"
                >
                  Room 1 start
                </label>

                <input
                  className=
                    "settingsInput"

                  type="number"
                  min="0"

                  value={
                    settingsForm
                      .r1Start
                  }

                  onChange={(e) =>
                    updateSetting(
                      "r1Start",
                      Number(
                        e.target.value
                      )
                    )
                  }
                />

              </div>

              <div>

                <label
                  className=
                    "settingsLabel"
                >
                  Room 1 end
                </label>

                <input
                  className=
                    "settingsInput"

                  type="number"
                  min="0"

                  value={
                    settingsForm
                      .r1End
                  }

                  onChange={(e) =>
                    updateSetting(
                      "r1End",
                      Number(
                        e.target.value
                      )
                    )
                  }
                />

              </div>

              <div>

                <label
                  className=
                    "settingsLabel"
                >
                  Room 2 start
                </label>

                <input
                  className=
                    "settingsInput"

                  type="number"
                  min="0"

                  value={
                    settingsForm
                      .r2Start
                  }

                  onChange={(e) =>
                    updateSetting(
                      "r2Start",
                      Number(
                        e.target.value
                      )
                    )
                  }
                />

              </div>

              <div>

                <label
                  className=
                    "settingsLabel"
                >
                  Room 2 end
                </label>

                <input
                  className=
                    "settingsInput"

                  type="number"
                  min="0"

                  value={
                    settingsForm
                      .r2End
                  }

                  onChange={(e) =>
                    updateSetting(
                      "r2End",
                      Number(
                        e.target.value
                      )
                    )
                  }
                />

              </div>

            </div>

            <button
              className=
                "primary fullBtn saveSettingsBtn"

              onClick={
                saveSettings
              }

              disabled={
                settingsSaving
              }
            >
              {settingsSaving
                ? "SAVING..."
                : "SAVE SETTINGS"}
            </button>

            {settingsMessage && (
              <div
                className=
                  "settingsMessage"
              >
                {settingsMessage}
              </div>
            )}

          </section>

        </div>

      </div>
    );
  }

  // =========================================================
  // MAIN PAGE
  // =========================================================

  return (
    <div className="page">

      <div className="appShell">

        <div className="topLine">

          <div>

            <div className="brand">
              GEYSERSTEAM
            </div>

            <h1>
              Sauna Remote
            </h1>

          </div>

          <button
            className="smallBtn"
            onClick={changeDevice}
          >
            Device
          </button>

        </div>

        <div
          className={
            backendOnline &&
            wsOnline
              ? "link good"
              : "link bad"
          }
        >
          {connectedText}
        </div>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {/* HEATER */}

        <section className="card">

          <Divider
            label="Heater Control"
          />

          <button
            className={
              status.on
                ? "power on"
                : "power"
            }

            onClick={() =>
              cmd(
                "power",

                status.on
                  ? "off"
                  : "on",

                {
                  on:
                    !status.on
                }
              )
            }
          >
            <span />
          </button>

          <div className="label">
            INTERNAL TEMPERATURE
          </div>

          <div className="mainTemp">

            {cToF(status.c)}

            <span>
              °F
            </span>

          </div>

          <div className="label">
            EXTERNAL SENSOR
          </div>

          <div className="extTemp">

            {cToF(status.e)}

            <span>
              °F
            </span>

          </div>

          <p className="summary">

            Set:{" "}

            <b>
              {Number(
                status.t || 0
              ).toFixed(1)}
            </b>

            °F | Timer:{" "}

            <b>
              {timerDisplay(
                status.tm
              )}
            </b>

            m

          </p>

          <Slider
            min="120"
            max="220"
            step="0.5"

            value={
              Number(
                status.t ?? 120
              )
            }

            onChange={(v) =>
              cmd(
                "target",
                Number(v),
                {
                  t: Number(v)
                }
              )
            }

            ticks={[
              "120",
              "170",
              "220"
            ]}
          />

          <Slider
            min="0"
            max="120"
            step="5"

            value={
              timerDisplay(
                status.tm
              )
            }

            onChange={(v) =>
              cmd(
                "timer",
                Number(v),
                {
                  tm: Number(v),

                  on:
                    Number(v) > 0
                      ? true
                      : status.on
                }
              )
            }

            ticks={[
              "0",
              "60",
              "120"
            ]}
          />

        </section>

        {/* INFRARED - CONDITIONAL */}

        {(status.infraredUI ===
          undefined ||
          boolFromStatus(
            status.infraredUI
          )) && (

          <section className="card">

            <Divider
              label="Infrared"
            />

            <p className="summary">

              Infrared Timer:{" "}

              <b>
                {timerDisplay(
                  status.itm
                )}
              </b>

              m

            </p>

            <Slider
              min="0"
              max="120"
              step="5"

              value={
                timerDisplay(
                  status.itm
                )
              }

              onChange={(v) =>
                cmd(
                  "irtime",
                  Number(v),
                  {
                    itm: Number(v),

                    iron:
                      Number(v) > 0
                  }
                )
              }

              ticks={[
                "0",
                "60",
                "120"
              ]}

              accent="red"
            />

          </section>
        )}

        {/* CHROMOTHERAPY */}

        <section className="card">

          <Divider
            label="Chromotherapy"
          />

          <div
            className=
              "roomSelector"
          >

            {roomOptions().map(
              ([id, name]) => (

                <button
                  key={id}

                  className={
                    selectedRoom() ===
                    id
                      ? "roomBtn active"
                      : "roomBtn"
                  }

                  onClick={() =>
                    cmd(
                      "room",
                      id,
                      {
                        rm: id
                      }
                    )
                  }
                >
                  {name}
                </button>
              )
            )}

          </div>

          <p className="summary">

            Light changes apply to:{" "}

            <b>
              {roomLabel()}
            </b>

          </p>

          <div className="lightArea">

            <div className="modeGrid">

              {MODES.map(
                ([
                  id,
                  name,
                  cls
                ]) => (

                  <button
                    key={id}

                    className={
                      `mode ${cls} ${
                        Number(
                          status.mode
                        ) === id &&
                        status.lon
                          ? "active"
                          : ""
                      }`
                    }

                    onClick={() =>
                      cmd(
                        "mode",
                        id,
                        {
                          mode: id,
                          lon: true
                        }
                      )
                    }
                  >
                    {name}
                  </button>
                )
              )}

              <button
                className={
                  status.lon
                    ? "ledToggle active"
                    : "ledToggle"
                }

                onClick={() =>
                  cmd(
                    "leds",

                    status.lon
                      ? "off"
                      : "on",

                    {
                      lon:
                        !status.lon
                    }
                  )
                }
              >
                LED ON/OFF
              </button>

            </div>

            <div className="brightness">

              <div>
                BRIGHT
              </div>

              <input
                type="range"
                min="10"
                max="255"

                value={
                  Number(
                    status.b ?? 150
                  )
                }

                onChange={(e) =>
                  cmd(
                    "bright",

                    Number(
                      e.target.value
                    ),

                    {
                      b:
                        Number(
                          e.target.value
                        )
                    }
                  )
                }
              />

              <div>
                DIM
              </div>

            </div>

          </div>

        </section>

        {/* AROMATHERAPY */}

        {boolFromStatus(
          status.aromaUI
        ) && (

          <section
            className=
              "card aromaCard"
          >

            <Divider
              label="Aromatherapy"
            />

            <div
              className=
                "fragranceGrid"
            >

              {[1, 2, 3, 4].map(
                (id) => (

                  <button
                    key={id}

                    className={
                      Number(
                        status.af ?? 1
                      ) === id
                        ? "fragranceBtn active"
                        : "fragranceBtn"
                    }

                    onClick={() =>
                      cmd(
                        "aroma-fragrance",
                        id,
                        {
                          af: id
                        }
                      )
                    }
                  >
                    FRAGRANCE {id}
                  </button>
                )
              )}

            </div>

            <div
              className=
                "aromaActionGrid"
            >

              <button
                className={
                  boolFromStatus(
                    status.steam
                  )
                    ? "aromaAction active"
                    : "aromaAction"
                }

                onClick={() =>
                  cmd(
                    "steam",

                    boolFromStatus(
                      status.steam
                    )
                      ? "off"
                      : "on",

                    {
                      steam:
                        !boolFromStatus(
                          status.steam
                        )
                    }
                  )
                }
              >
                STEAM{" "}

                {boolFromStatus(
                  status.steam
                )
                  ? "ON"
                  : "OFF"}
              </button>

              <button
                className={
                  boolFromStatus(
                    status.aen
                  )
                    ? "aromaAction active"
                    : "aromaAction"
                }

                onClick={() =>
                  cmd(
                    "aroma-enable",

                    boolFromStatus(
                      status.aen
                    )
                      ? "off"
                      : "on",

                    {
                      aen:
                        !boolFromStatus(
                          status.aen
                        )
                    }
                  )
                }
              >
                AROMA{" "}

                {boolFromStatus(
                  status.aen
                )
                  ? "ON"
                  : "OFF"}
              </button>

              <button
                className={
                  boolFromStatus(
                    status.amanual
                  )
                    ? "aromaAction prime active"
                    : "aromaAction prime"
                }

                onPointerDown={(e) => {
                  e.preventDefault();
                  startPrime();
                }}

                onPointerUp={stopPrime}
                onPointerCancel={stopPrime}
                onPointerLeave={stopPrime}

                onContextMenu={(e) =>
                  e.preventDefault()
                }
              >
                HOLD TO PRIME
              </button>

            </div>

            <p className="summary">

              Drop period:{" "}

              <b>
                {Number(
                  status.ap ?? 60
                )}
              </b>

              {" "}seconds

            </p>

            <Slider
              min="10"
              max="300"
              step="5"

              value={
                Number(
                  status.ap ?? 60
                )
              }

              onChange={(v) =>
                cmd(
                  "aroma-period",
                  Number(v),
                  {
                    ap: Number(v)
                  }
                )
              }

              ticks={[
                "10",
                "155",
                "300"
              ]}

              accent="green"
            />

            <div
              className={
                boolFromStatus(
                  status.apump
                )
                  ? "pumpStatus running"
                  : "pumpStatus"
              }
            >

              {boolFromStatus(
                status.apump
              )
                ? boolFromStatus(
                    status.amanual
                  )
                  ? `Priming fragrance ${
                      Number(
                        status.af ?? 1
                      )
                    }`
                  : `Dosing fragrance ${
                      Number(
                        status.af ?? 1
                      )
                    }`
                : "Pump stopped"}

            </div>

          </section>
        )}

        {/* SETTINGS */}

        <section
          className=
            "card systemCard"
        >

          <Divider
            label="System"
          />

          <button
            className=
              "settingsBtn"

            onClick={
              openSettings
            }
          >
            SETTINGS
          </button>

        </section>

      </div>

    </div>
  );
}

// ===========================================================
// DIVIDER
// ===========================================================

function Divider({
  label
}) {
  return (
    <div className="divider">

      <span>
        {label}
      </span>

    </div>
  );
}

// ===========================================================
// SLIDER
// ===========================================================

function Slider({
  value,
  onChange,
  ticks,
  accent = "orange",
  ...props
}) {
  return (
    <div className="sliderWrap">

      <input
        className={
          `slider ${accent}`
        }

        type="range"

        value={value}

        onChange={(e) =>
          onChange(
            e.target.value
          )
        }

        {...props}
      />

      <div className="ticks">

        {ticks.map(
          (t) => (

            <div
              className="tick"
              key={t}
            >

              <span>
                {t}
              </span>

            </div>
          )
        )}

      </div>

    </div>
  );
}
