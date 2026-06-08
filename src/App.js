import React, { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";


function makeWsBase() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

const WS_BASE = makeWsBase();

const MODES = [
  [1, "FIRE", "orange"], [2, "ZEN", "cyan"], [3, "WARM", "warm"],
  [4, "COOL", "cool"], [5, "GOLD", "gold"], [10, "LAVA", "lava"],
  [7, "PURPLE", "purple"], [9, "FOREST", "forest"], [8, "SUNSET", "sunset"],
  [11, "OCEAN", "ocean"], [6, "DEEP", "deep"], [12, "PARTY", "party"],
];

const ROOMS = [
  [1, "SAUNA"],
  [2, "STEAM R"],
  [3, "BOTH R"],
];

function cleanDeviceId(value) {
  return String(value || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return "--";
  return (n * 1.8 + 32).toFixed(1);
}

function timerDisplay(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}
function getDeviceIdFromText(text = "") {
  const raw = String(text || "").trim();

  try {
    const url = new URL(raw);
    return cleanDeviceId(url.searchParams.get("device"));
  } catch {}

  const params = new URLSearchParams(window.location.search);
  const fromUrl = cleanDeviceId(params.get("device"));
  if (fromUrl.length === 12) return fromUrl;

  return cleanDeviceId(raw);
}
export default function App() {
  const urlDeviceId = cleanDeviceId(
    new URLSearchParams(window.location.search).get("device")
  );
  console.log("href:", window.location.href);
  console.log("search:", window.location.search);
  console.log("urlDeviceId:", urlDeviceId);
  console.log("initialDeviceId:", initialDeviceId);
  const initialDeviceId =
  urlDeviceId.length === 12
    ? urlDeviceId
    : localStorage.getItem("saunaDeviceId") || "";
  
  const [showQr, setShowQr] = useState(false);
  const [deviceId, setDeviceId] = useState(initialDeviceId);

  const [entryId, setEntryId] = useState(initialDeviceId);
  const debugText = `
    href: ${window.location.href}
    search: ${window.location.search}
    urlDeviceId: ${urlDeviceId}
    initialDeviceId: ${initialDeviceId}
    deviceId: ${deviceId}
  `;
  const [status, setStatus] = useState({
    t: 107.5,
    tm: 0,
    itm: 0,
    b: 150,
    mode: 1,
    lon: true,
    rm: 3,
  });
  const [backendOnline, setBackendOnline] = useState(false);
  const [wsOnline, setWsOnline] = useState(false);
  const [error, setError] = useState("");
  const wsRef = useRef(null);
  

  const connectedText = useMemo(() => {
    if (!backendOnline) return "BACKEND OFFLINE";
    if (!wsOnline) return "WAITING FOR LIVE STATUS";
    return "REMOTE MQTT LINK ACTIVE";
  }, [backendOnline, wsOnline]);



  useEffect(() => {
    if (deviceId && deviceId.length === 12) {
      localStorage.setItem("saunaDeviceId", deviceId);
    }
  }, [deviceId]);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((d) => setBackendOnline(Boolean(d.ok)))
      .catch(() => setBackendOnline(false));
  }, []);

  useEffect(() => {
  	if (!showQr) return;

  	const scanner = new Html5QrcodeScanner(
    		"qr-reader",
    		{
      			fps: 10,
      			qrbox: 250,
    		},
    		false
  	);

  	scanner.render(
    		(decodedText) => {
      			const cleaned = getDeviceIdFromText(decodedText);

     			 if (cleaned.length === 12) {
        			setEntryId(cleaned);
        			localStorage.setItem("saunaDeviceId", cleaned);
        			setDeviceId(cleaned);
        			setShowQr(false);
        			scanner.clear();
      			} else {
        			setError("QR code did not contain a valid 12-character Device 					ID.");
      			}
    		},
    		() => {}
  	);

  	return () => {
    		scanner.clear().catch(() => {});
  	};
  }, [showQr]);

  useEffect(() => {
    if (!deviceId) return;

    let stopped = false;

    fetch(`${API_BASE}/api/device/${deviceId}/status`)
      .then((r) => r.json())
      .then((d) => {
        if (d) setStatus((prev) => ({ ...prev, ...d }));
      })
      .catch(() => {});

    function connectWs() {
      if (stopped) return;

      const ws = new WebSocket(`${WS_BASE}?deviceId=${deviceId}`);
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

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "status") {
            setStatus((prev) => ({ ...prev, ...msg.status }));
          }

          if (msg.type === "error") {
            setError(msg.error);
          }
        } catch {}
      };

      ws.onclose = () => {
        setWsOnline(false);
        if (!stopped) setTimeout(connectWs, 3000);
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

  // Client-side countdown so timer sliders move smoothly between MQTT updates.
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus((prev) => {
        const next = { ...prev };

        if (next.on && Number(next.tm) > 0) {
          next.tm = Math.max(0, Number(next.tm) - 1 / 60);
        }

        if (Number(next.itm) > 0) {
          next.itm = Math.max(0, Number(next.itm) - 1 / 60);
          next.iron = next.itm > 0;
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  function saveDeviceId() {
    const cleaned = cleanDeviceId(entryId);

    if (cleaned.length !== 12) {
      setError("Device ID must be 12 hex characters, like A0B76314F23C.");
      return;
    }

    localStorage.setItem("saunaDeviceId", cleaned);
    setDeviceId(cleaned);
    setError("");
  }

  function changeDevice() {
    localStorage.removeItem("saunaDeviceId");
    setDeviceId("");
    setEntryId("");
    setStatus({
      t: 107.5,
      tm: 0,
      itm: 0,
      b: 150,
      mode: 1,
      lon: true,
      rm: 3,
    });
  }

  async function cmd(command, value) {

    try {
      const r = await fetch(`${API_BASE}/api/device/${deviceId}/cmd/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });

      const data = await r.json();

      if (!r.ok) {
        throw new Error(data.error || "Command failed");
      }

      setError("");
    } catch (e) {
      setError(e.message || "Command failed");
    }
  }

  function selectedRoom() {
    const rm = Number(status.rm ?? 3);
    return rm >= 1 && rm <= 3 ? rm : 3;
  }

  function roomLabel() {
    const rm = selectedRoom();
    return ROOMS.find(([id]) => id === rm)?.[1] || "BOTH R";
  }

  if (!deviceId) {
    return (
      <div className="page setupPage">
        <div className="panel setupPanel">
          <div className="brand">GEYSERSTEAM</div>
          <h1>Sauna Remote</h1>
          <p>Enter your sauna Device ID to continue.</p>
	  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
  		{debugText}
	  </pre>
          <input
            className="deviceInput"
            value={entryId}
            onChange={(e) => setEntryId(cleanDeviceId(e.target.value))}
            placeholder="A0B76314F23C"
          />

          <button className="primary" onClick={saveDeviceId}>
            CONNECT
          </button>
	  <button className="secondary" onClick={() => setShowQr(true)}>
  		SCAN QR CODE
	  </button>

	  {showQr && (
  		<div className="qrPanel">
    			<div id="qr-reader"></div>

    			<button className="smallBtn" onClick={() => setShowQr(false)}>
     			 Cancel
    			</button>
  		</div>
	  )}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="appShell">
        <div className="topLine">
          <div>
            <div className="brand">GEYSERSTEAM</div>
            <h1>Sauna Remote</h1>
          </div>

          <button className="smallBtn" onClick={changeDevice}>
            Device
          </button>
        </div>

        <div className={backendOnline && wsOnline ? "link good" : "link bad"}>
          {connectedText}
        </div>

        {error && <div className="error">{error}</div>}

        <section className="card">
          <Divider label="Heater Control" />

          <button
            className={status.on ? "power on" : "power"}
            onClick={() =>
              cmd("power", status.on ? "off" : "on", { on: !status.on })
            }
          >
            <span></span>
          </button>

          <div className="label">INTERNAL TEMPERATURE</div>
          <div className="mainTemp">
            {cToF(status.c)}
            <span>°F</span>
          </div>

          <div className="label">EXTERNAL SENSOR</div>
          <div className="extTemp">
            {cToF(status.e)}
            <span>°F</span>
          </div>

          <p className="summary">
            Set: <b>{Number(status.t || 0).toFixed(1)}</b>°F | Timer:{" "}
            <b>{timerDisplay(status.tm)}</b>m
          </p>

          <Slider
            min="120"
            max="220"
            step="0.5"
            value={Number(status.t ?? 107.5)}
            onChange={(v) => cmd("target", Number(v), { t: Number(v) })}
            ticks={["120", "170", "220"]}
          />

          <Slider
            min="0"
            max="120"
            step="5"
            value={timerDisplay(status.tm)}
            onChange={(v) =>
              cmd("timer", Number(v), {
                tm: Number(v),
                on: Number(v) > 0 ? true : status.on,
              })
            }
            ticks={["0", "60", "120"]}
          />
        </section>

        <section className="card">
          <Divider label="Infrared" />

          <p className="summary">
            Infrared Timer: <b>{timerDisplay(status.itm)}</b>m
          </p>

          <Slider
            min="0"
            max="120"
            step="5"
            value={timerDisplay(status.itm)}
            onChange={(v) =>
              cmd("irtime", Number(v), {
                itm: Number(v),
                iron: Number(v) > 0,
              })
            }
            ticks={["0", "60", "120"]}
            accent="red"
          />
        </section>

        <section className="card">
          <Divider label="Chromotherapy" />

          <div className="roomSelector">
            {ROOMS.map(([id, name]) => (
              <button
                key={id}
                className={selectedRoom() === id ? "roomBtn active" : "roomBtn"}
                onClick={() => cmd("room", id)}
              >
                {name}
              </button>
            ))}
          </div>

          <p className="summary">
            Light changes apply to: <b>{roomLabel()}</b>
          </p>

          <div className="lightArea">
            <div className="modeGrid">
              {MODES.map(([id, name, cls]) => (
                <button
                  key={id}
                  className={`mode ${cls} ${
                    Number(status.mode) === id && status.lon ? "active" : ""
                  }`}
                  onClick={() => cmd("mode", id)}
                >
                  {name}
                </button>
              ))}

              <button
                className={status.lon ? "ledToggle active" : "ledToggle"}
                onClick={() =>
                  cmd("leds", status.lon ? "off" : "on", { lon: !status.lon })
                }
              >
                LED ON/OFF
              </button>
            </div>

            <div className="brightness">
              <div>BRIGHT</div>

              <input
                type="range"
                min="10"
                max="255"
                value={Number(status.b ?? 150)}
                onChange={(e) =>
                  cmd("bright", Number(e.target.value))
                }
              />

              <div>DIM</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Divider({ label }) {
  return (
    <div className="divider">
      <span>{label}</span>
    </div>
  );
}

function Slider({ value, onChange, ticks, accent = "orange", ...props }) {
  return (
    <div className="sliderWrap">
      <input
        className={`slider ${accent}`}
        type="range"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />

      <div className="ticks">
        {ticks.map((t) => (
          <div className="tick" key={t}>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}