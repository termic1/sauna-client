import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  Html5QrcodeScanner
} from "html5-qrcode";

import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3001";

function makeWsBase() {
  const url =
    new URL(API_BASE);

  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : "ws:";

  url.pathname = "/ws";

  return url.toString();
}

const WS_BASE =
  makeWsBase();

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

const roomName = (n) => Number(n) === 2 ? "STEAM R" : "SAUNA";
const roomChoices = (status) => {
  const one = [1, roomName(status.name1 ?? (status.reverseRooms ? 2 : 1))];
  if (Number(status.name2 ?? (status.reverseRooms ? 1 : 2)) === 0) return [one];
  return [one, [2, roomName(status.name2 ?? (status.reverseRooms ? 1 : 2))], [3, "BOTH R"]];
};
const isModernController = (status) => {
  if (!["name1","name2","type1","type2","shareRGB"].every(k => status?.[k] != null)) return false;
  const match = String(status.fw || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major,minor,patch] = match.slice(1).map(Number);
  return major > 2 || (major === 2 && (minor > 4 || (minor === 4 && patch >= 1)));
};
const ledTypeName = (type) => ({0:"Disabled",1:"WS2812 Color",2:"24V White PWM"})[Number(type)] ?? "Unknown";
const settingsFromStatus = (st) => ({
  newPassword: "", aromaUI: boolFromStatus(st.aromaUI),
  reverseRooms: boolFromStatus(st.reverseRooms),
  whiteMode: boolFromStatus(st.whiteMode), white2: boolFromStatus(st.white2),
  infraredUI: st.infraredUI == null ? true : boolFromStatus(st.infraredUI),
  reverseEncoder: boolFromStatus(st.reverseEncoder),
  name1: Number(st.name1 ?? (st.reverseRooms ? 2 : 1)), name2: Number(st.name2 ?? (st.reverseRooms ? 1 : 2)),
  type1: Number(st.type1 ?? (st.whiteMode ? 2 : 1)),
  type2: Number(st.type2 ?? (st.white2 ? 2 : 1)),
  shareRGB: Number(st.shareRGB ?? 1),
  ledTotal: Number(st.ledTotal ?? 600), r1Start: Number(st.r1Start ?? 3),
  r1End: Number(st.r1End ?? 272), r2Start: Number(st.r2Start ?? 300),
  r2End: Number(st.r2End ?? 599), led2Total: Number(st.led2Total ?? 300),
  led2Start: Number(st.led2Start ?? 0), led2End: Number(st.led2End ?? 299)
});

function cleanDeviceId(value) {
  return String(value || "")
    .replace(
      /[^a-fA-F0-9]/g,
      ""
    )
    .toUpperCase();
}

function cToF(c) {
  const n = Number(c);

  if (!Number.isFinite(n)) {
    return "--";
  }

  return (
    n * 1.8 + 32
  ).toFixed(1);
}

function timerDisplay(value) {
  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return 0;
  }

  return Math.ceil(n);
}

function getDeviceIdFromText(
  text = ""
) {
  const raw =
    String(text || "").trim();

  try {
    const url =
      new URL(raw);

    return cleanDeviceId(
      url.searchParams.get(
        "device"
      )
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

  if (
    fromUrl.length === 12
  ) {
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

  const [
    showQr,
    setShowQr
  ] = useState(false);

  const [
    deviceId,
    setDeviceId
  ] = useState(
    initialDeviceId
  );

  const [
    entryId,
    setEntryId
  ] = useState(
    initialDeviceId
  );

  const [
    status,
    setStatus
  ] = useState({
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

    // LED installation
    ledTotal: 600,
    r1Start: 3,
    r1End: 272,
    r2Start: 300,
    r2End: 599,
    name1: 1, name2: 2, type1: 1, type2: 1, shareRGB: 1,
    led2Total: 300, led2Start: 0, led2End: 299,
    rb1: 150, rb2: 150, ron1: true, ron2: true
  });

  const [
    backendOnline,
    setBackendOnline
  ] = useState(false);

  const [
    wsOnline,
    setWsOnline
  ] = useState(false);

  const [
    error,
    setError
  ] = useState("");

  const [
    view,
    setView
  ] = useState("main");

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

  const [settingsForm, setSettingsForm] = useState(() => settingsFromStatus({}));

  const wsRef =
    useRef(null);

  const primeActiveRef =
    useRef(false);

  const connectedText =
    useMemo(() => {
      if (!backendOnline) {
        return (
          "BACKEND OFFLINE"
        );
      }

      if (!wsOnline) {
        return (
          "WAITING FOR LIVE STATUS"
        );
      }

      return (
        "REMOTE MQTT LINK ACTIVE"
      );
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
      .then((r) =>
        r.json()
      )
      .then((d) =>
        setBackendOnline(
          Boolean(d.ok)
        )
      )
      .catch(() =>
        setBackendOnline(
          false
        )
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

        if (
          cleaned.length === 12
        ) {
          setEntryId(cleaned);

          localStorage.setItem(
            "saunaDeviceId",
            cleaned
          );

          setDeviceId(
            cleaned
          );

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
      .then((r) =>
        r.json()
      )
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
            type:
              "subscribe",

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
              msg.type ===
              "status"
            ) {
              setStatus(
                (prev) => ({
                  ...prev,
                  ...msg.status
                })
              );
            }

            if (
              msg.type ===
              "error"
            ) {
              setError(
                msg.error
              );
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
              Number(
                next.tm
              ) > 0
            ) {
              next.tm =
                Math.max(
                  0,
                  Number(
                    next.tm
                  ) -
                    1 / 60
                );
            }

            if (
              Number(
                next.itm
              ) > 0
            ) {
              next.itm =
                Math.max(
                  0,
                  Number(
                    next.itm
                  ) -
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
      clearInterval(
        interval
      );
  }, []);

  // =========================================================
  // DEVICE
  // =========================================================

  function saveDeviceId() {
    const cleaned =
      cleanDeviceId(
        entryId
      );

    if (
      cleaned.length !== 12
    ) {
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

    setStatus({t:120,tm:0,itm:0,b:150,mode:1,lon:false,rm:1,
      af:1,aen:false,ap:60,steam:false,apump:false,amanual:false,aromaUI:false,
      ...settingsFromStatus({})});
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
    const rm = Number(status.rm ?? 1);
    const options = roomChoices(status);
    return options.some(([id]) => id === rm) ? rm : 1;
  }
  function roomLabel() {
    return roomChoices(status).find(([id]) => id === selectedRoom())?.[1] || "SAUNA";
  }
  const legacyWhite = boolFromStatus(status.whiteMode);
  const roomTypes = !isModernController(status)
    ? [legacyWhite ? 2 : 1]
    : selectedRoom() === 3
      ? [Number(status.type1 ?? 1), Number(status.type2 ?? 1)]
      : [Number(selectedRoom() === 2 ? status.type2 ?? 1 : status.type1 ?? 1)];
  const showColor = roomTypes.includes(1);
  const showWhite = roomTypes.includes(2);
  const selectedBrightness = selectedRoom() === 2 ? Number(status.rb2 ?? status.b ?? 150)
    : Number(status.rb1 ?? status.b ?? 150);
  const selectedLightOn = selectedRoom() === 2 ? boolFromStatus(status.ron2 ?? status.lon)
    : selectedRoom() === 1 ? boolFromStatus(status.ron1 ?? status.lon)
    : boolFromStatus(status.ron1 ?? status.lon) && boolFromStatus(status.ron2 ?? status.lon);

  // =========================================================
  // PRIME
  // =========================================================

  function startPrime() {
    if (
      primeActiveRef.current
    ) {
      return;
    }

    primeActiveRef.current =
      true;

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

    primeActiveRef.current =
      false;

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
  //
  // Password is now verified by the ESP32 BEFORE the
  // settings page opens.
  // =========================================================

  async function openSettings() {

    const password =
      window.prompt(
        "Enter settings password:"
      );

    if (
      password === null
    ) {
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
            method:
              "POST",

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

      // Password was verified by ESP32.

      setSettingsPassword(
        cleanPassword
      );

      setSettingsForm(settingsFromStatus(status));

      setSettingsMessage(
        ""
      );

      setView(
        "settings"
      );
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
    const f = settingsForm;
    const modern = isModernController(status);
    const n = (v) => Number(v);
    const validRange = (total,a,b) => Number.isInteger(n(total)) && n(total)>=1 && n(total)<=5000 &&
      Number.isInteger(n(a)) && Number.isInteger(n(b)) && n(a)>=0 && n(b)>=n(a) && n(b)<n(total);
    if (modern && ![1,2].includes(n(f.name1)) || ![0,1,2].includes(n(f.name2))) return "Invalid room names.";
    if (modern && ![1,2].includes(n(f.type1)) || ![0,1,2].includes(n(f.type2))) return "Invalid LED type.";
    if (modern && (n(f.name2)===0)!==(n(f.type2)===0)) return "A disabled room must have disabled LEDs.";
    if (!validRange(f.ledTotal,f.r1Start,f.r1End) || !validRange(f.ledTotal,f.r2Start,f.r2End))
      return "Invalid GPIO47 LED ranges (0 to total minus 1).";
    if (modern && n(f.type2)===1 && !(n(f.type1)===1 && n(f.shareRGB)===1) &&
        !validRange(f.led2Total,f.led2Start,f.led2End))
      return "Invalid GPIO42 LED range.";
    return "";
  }

  // =========================================================
  // SAVE SETTINGS
  // =========================================================

  async function saveSettings() {

    const validationError =
      validateSettingsForm();

    if (
      validationError
    ) {
      setSettingsMessage(
        validationError
      );

      return;
    }

    setSettingsSaving(true);
    setSettingsMessage("");

    const payload = {
      password: settingsPassword,
      controllerGeneration: isModernController(status) ? "modern" : "legacy",
      reverseRooms: Boolean(settingsForm.reverseRooms),
      whiteMode: Boolean(settingsForm.whiteMode),
      white2: Boolean(settingsForm.white2),
      newPassword: settingsForm.newPassword.trim(),
      aromaUI: Boolean(settingsForm.aromaUI),
      infraredUI: Boolean(settingsForm.infraredUI),
      reverseEncoder: Boolean(settingsForm.reverseEncoder),
      name1: Number(settingsForm.name1), name2: Number(settingsForm.name2),
      type1: Number(settingsForm.type1), type2: Number(settingsForm.name2) === 0 ? 0 : Number(settingsForm.type2),
      shareRGB: Number(settingsForm.type1) === 1 && Number(settingsForm.type2) === 1 ? Number(settingsForm.shareRGB) : 0,
      ledTotal: Number(settingsForm.ledTotal), r1Start: Number(settingsForm.r1Start),
      r1End: Number(settingsForm.r1End), r2Start: Number(settingsForm.r2Start),
      r2End: Number(settingsForm.r2End), led2Total: Number(settingsForm.led2Total),
      led2Start: Number(settingsForm.led2Start), led2End: Number(settingsForm.led2End)
    };

    try {
      const r =
        await fetch(
          `${API_BASE}/api/device/${deviceId}/settings`,
          {
            method:
              "POST",

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

      // The ESP32 confirms the applied configuration in its next MQTT status.
      // Do not show unconfirmed installation settings as saved.

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
      setSettingsSaving(
        false
      );
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

  if (
    view === "settings"
  ) {
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

                setSettingsMessage(
                  ""
                );
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
              className=
                "switchRow"
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

          <section className="card settingsCard">
            <Divider label="Controller Options" />
            {[["infraredUI","Show infrared controls"],["reverseEncoder","Reverse encoder direction"]].map(([key,label]) => (
              <label className="switchRow" key={key}><strong>{label}</strong>
                <input type="checkbox" checked={Boolean(settingsForm[key])}
                  onChange={e=>updateSetting(key,e.target.checked)}/></label>
            ))}
          </section>
          {isModernController(status) ? (
          <section className="card settingsCard">
            <Divider label="Room Configuration" />
            <label className="settingsLabel">Room 1 name (GPIO47)</label>
            <select className="settingsInput" value={settingsForm.name1} onChange={e=>updateSetting("name1",Number(e.target.value))}>
              <option value={1}>Sauna</option><option value={2}>Steam Room</option>
            </select>
            <label className="settingsLabel">Room 1 LEDs</label>
            <select className="settingsInput" value={settingsForm.type1} onChange={e=>updateSetting("type1",Number(e.target.value))}>
              <option value={1}>WS2812 Color</option><option value={2}>24V White (PWM)</option>
            </select>
            <label className="settingsLabel">Room 2 name (GPIO42)</label>
            <select className="settingsInput" value={settingsForm.name2} onChange={e=>{
              const value=Number(e.target.value);setSettingsForm(p=>({...p,name2:value,type2:value===0?0:(p.type2===0?1:p.type2)}));
            }}><option value={0}>Disabled</option><option value={1}>Sauna</option><option value={2}>Steam Room</option></select>
            <label className="settingsLabel">Room 2 LEDs</label>
            <select className="settingsInput" disabled={Number(settingsForm.name2)===0} value={settingsForm.name2===0?0:settingsForm.type2}
              onChange={e=>updateSetting("type2",Number(e.target.value))}>
              <option value={0}>Disabled</option><option value={1}>WS2812 Color</option><option value={2}>24V White (PWM)</option>
            </select>
            {Number(settingsForm.type1)===1 && Number(settingsForm.type2)===1 && Number(settingsForm.name2)!==0 && <>
              <label className="settingsLabel">WS2812 wiring</label>
              <select className="settingsInput" value={settingsForm.shareRGB} onChange={e=>updateSetting("shareRGB",Number(e.target.value))}>
                <option value={1}>One shared strand on GPIO47</option><option value={0}>Independent strands on GPIO47 and GPIO42</option>
              </select>
            </>}
            {Number(settingsForm.type2)===1 && !(Number(settingsForm.type1)===1 && Number(settingsForm.shareRGB)===1) && <>
              <Divider label="GPIO42 Color Strand" />
              {[["led2Total","Total physical LEDs"],["led2Start","Useful first LED"],["led2End","Useful last LED"]].map(([key,label])=>(
                <label key={key} className="settingsLabel">{label}
                  <input className="settingsInput" type="number" min="0" max="5000" value={settingsForm[key]}
                    onChange={e=>updateSetting(key,Number(e.target.value))}/></label>
              ))}
            </>}
          </section>

          ) : (
            <section className="card settingsCard">
              <Divider label="Legacy Room Configuration" />
              <div className="settingsHelp">This controller uses the original shared WS2812 strand configuration. Its new multi-light settings are not available without a firmware update.</div>
              <label className="switchRow"><strong>Reverse Sauna / Steam room names</strong>
                <input type="checkbox" checked={Boolean(settingsForm.reverseRooms)}
                  onChange={e=>updateSetting("reverseRooms",e.target.checked)} /></label>
              {status.whiteMode !== undefined && <label className="switchRow"><strong>White LED mode (legacy)</strong>
                <input type="checkbox" checked={Boolean(settingsForm.whiteMode)}
                  onChange={e=>updateSetting("whiteMode",e.target.checked)} /></label>}
              {status.white2 !== undefined && <label className="switchRow"><strong>Second white LED output (legacy)</strong>
                <input type="checkbox" checked={Boolean(settingsForm.white2)}
                  onChange={e=>updateSetting("white2",e.target.checked)} /></label>}
            </section>
          )}

          {/* LED SETTINGS */}

          <section
            className=
              "card settingsCard"
          >

            <Divider
              label="GPIO47 / Shared Strand LED Ranges"
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
                status.t ??
                  120
              )
            }

            onChange={(v) =>
              cmd(
                "target",
                Number(v),
                {
                  t:
                    Number(v)
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
                  tm:
                    Number(v),

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

        {/* INFRARED */}

        {(status.infraredUI == null || boolFromStatus(status.infraredUI)) && <section className="card">

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
                  itm:
                    Number(v),

                  iron:
                    Number(v) >
                    0
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

        </section>}

        {/* CHROMOTHERAPY */}

        <section className="card">

          <Divider
            label="Chromotherapy"
          />

          <div
            className=
              "roomSelector"
          >

            {roomChoices(status).map(
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
            <p className="summary">{roomTypes.map(ledTypeName).join(" / ")}</p>
            {showColor && <div className="modeGrid">
              {MODES.map(([id,name,cls]) => <button key={id}
                className={`mode ${cls} ${Number(status.mode)===id && selectedLightOn ? "active":""}`}
                onClick={()=>cmd("mode",id,{mode:id,lon:true})}>{name}</button>)}
            </div>}
            {(showColor || showWhite) && <>
              <button className={selectedLightOn ? "ledToggle active" : "ledToggle"}
                onClick={()=>cmd("leds",selectedLightOn?"off":"on",{
                  lon:!selectedLightOn,
                  ...(selectedRoom()===1?{ron1:!selectedLightOn}:selectedRoom()===2?{ron2:!selectedLightOn}:{ron1:!selectedLightOn,ron2:!selectedLightOn})
                })}>LED {selectedLightOn?"ON — TURN OFF":"OFF — TURN ON"}</button>
              <div className="brightness"><div>BRIGHT</div>
                <input type="range" min="0" max="255" value={selectedBrightness}
                  onChange={e=>{const v=Number(e.target.value);cmd("bright",v,{
                    b:v,...(selectedRoom()===1?{rb1:v}:selectedRoom()===2?{rb2:v}:{rb1:v,rb2:v})
                  });}} />
                <div>DIM</div>
              </div>
            </>}
            {!showColor && !showWhite && <p className="summary">Lighting is disabled for this room.</p>}
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
                        status.af ??
                          1
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

                onPointerDown={(
                  e
                ) => {
                  e.preventDefault();

                  startPrime();
                }}

                onPointerUp={
                  stopPrime
                }

                onPointerCancel={
                  stopPrime
                }

                onPointerLeave={
                  stopPrime
                }

                onContextMenu={(
                  e
                ) =>
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
                  status.ap ??
                    60
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
                  status.ap ??
                    60
                )
              }

              onChange={(v) =>
                cmd(
                  "aroma-period",

                  Number(v),

                  {
                    ap:
                      Number(v)
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
                        status.af ??
                          1
                      )
                    }`
                  : `Dosing fragrance ${
                      Number(
                        status.af ??
                          1
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
