import React, { useEffect, useMemo, useRef, useState } from "react";

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

function cleanDeviceId(value) {
  return String(value || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return "--";
  return (n * 1.8 + 32).toFixed(1);
}

export default function App() {
  const [deviceId, setDeviceId] = useState(localStorage.getItem("saunaDeviceId") || "");
  const [entryId, setEntryId] = useState(deviceId);
  const [status, setStatus] = useState({ t: 107.5, tm: 0, itm: 0, b: 150, mode: 1, lon: true });
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
    fetch(`${API_BASE}/api/health`).then(r => r.json()).then(d => {
      setBackendOnline(Boolean(d.ok));
    }).catch(() => setBackendOnline(false));
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let stopped = false;

    fetch(`${API_BASE}/api/device/${deviceId}/status`)
      .then(r => r.json())
      .then(d => { if (d) setStatus(prev => ({ ...prev, ...d })); })
      .catch(() => {});

    function connectWs() {
      if (stopped) return;
      const ws = new WebSocket(`${WS_BASE}?deviceId=${deviceId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsOnline(true);
        setError("");
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "status") setStatus(prev => ({ ...prev, ...msg.status }));
          if (msg.type === "error") setError(msg.error);
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
    setStatus({ t: 107.5, tm: 0, itm: 0, b: 150, mode: 1, lon: true });
  }

  async function cmd(command, value, patch = {}) {
    setStatus(prev => ({ ...prev, ...patch }));
    try {
      const r = await fetch(`${API_BASE}/api/device/${deviceId}/cmd/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Command failed");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  if (!deviceId) {
    return <div className="page setupPage">
      <div className="panel setupPanel">
        <div className="brand">GEYSERSTEAM</div>
        <h1>Sauna Remote</h1>
        <p>Enter your sauna Device ID to continue.</p>
        <input className="deviceInput" value={entryId} onChange={e => setEntryId(cleanDeviceId(e.target.value))} placeholder="A0B76314F23C" />
        <button className="primary" onClick={saveDeviceId}>CONNECT</button>
        {error && <div className="error">{error}</div>}
      </div>
    </div>;
  }

  return <div className="page">
    <div className="appShell">
      <div className="topLine">
        <div>
          <div className="brand">GEYSERSTEAM</div>
          <h1>Sauna Remote</h1>
        </div>
        <button className="smallBtn" onClick={changeDevice}>Device</button>
      </div>

      <div className={backendOnline && wsOnline ? "link good" : "link bad"}>{connectedText}</div>
      {error && <div className="error">{error}</div>}

      <section className="card">
        <Divider label="Heater Control" />
        <button className={status.on ? "power on" : "power"} onClick={() => cmd("power", status.on ? "off" : "on", { on: !status.on })}>
          <span></span>
        </button>
        <div className="label">INTERNAL TEMPERATURE</div>
        <div className="mainTemp">{cToF(status.c)}<span>°F</span></div>
        <div className="label">EXTERNAL SENSOR</div>
        <div className="extTemp">{cToF(status.e)}<span>°F</span></div>
        <p className="summary">Set: <b>{Number(status.t || 0).toFixed(1)}</b>°F | Timer: <b>{status.tm || 0}</b>m</p>
        <Slider min="90" max="135" step="0.5" value={status.t ?? 107.5} onChange={v => cmd("target", Number(v), { t: Number(v) })} ticks={["90", "112", "135"]} />
        <Slider min="0" max="120" step="5" value={status.tm ?? 0} onChange={v => cmd("timer", Number(v), { tm: Number(v), on: Number(v) > 0 ? true : status.on })} ticks={["0", "60", "120"]} />
      </section>

      <section className="card">
        <Divider label="Infrared" />
        <p className="summary">Infrared Timer: <b>{status.itm || 0}</b>m</p>
        <Slider min="0" max="120" step="5" value={status.itm ?? 0} onChange={v => cmd("irtime", Number(v), { itm: Number(v), iron: Number(v) > 0 })} ticks={["0", "60", "120"]} accent="red" />
      </section>

      <section className="card">
        <Divider label="Chromotherapy" />
        <div className="lightArea">
          <div className="modeGrid">
            {MODES.map(([id, name, cls]) => <button key={id} className={`mode ${cls} ${Number(status.mode) === id && status.lon ? "active" : ""}`} onClick={() => cmd("mode", id, { mode: id, lon: true })}>{name}</button>)}
            <button className={status.lon ? "ledToggle active" : "ledToggle"} onClick={() => cmd("leds", status.lon ? "off" : "on", { lon: !status.lon })}>LED ON/OFF</button>
          </div>
          <div className="brightness">
            <div>BRIGHT</div>
            <input type="range" min="10" max="255" value={status.b ?? 150} onChange={e => cmd("bright", Number(e.target.value), { b: Number(e.target.value) })} />
            <div>DIM</div>
          </div>
        </div>
      </section>
    </div>
  </div>;
}

function Divider({ label }) {
  return <div className="divider"><span>{label}</span></div>;
}

function Slider({ value, onChange, ticks, accent = "orange", ...props }) {
  return <div className="sliderWrap">
    <input className={`slider ${accent}`} type="range" value={value} onChange={e => onChange(e.target.value)} {...props} />
    <div className="ticks">{ticks.map(t => <div className="tick" key={t}><span>{t}</span></div>)}</div>
  </div>;
}
