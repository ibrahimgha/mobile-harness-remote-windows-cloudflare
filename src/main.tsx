import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ControlRoom } from "./ControlRoom";
import { MachineTracker } from "./MachineTracker";
import "./styles.css";

const isControlRoom = window.location.pathname.replace(/\/+$/, "") === "/control-room";
const isControlRoomTile = new URLSearchParams(window.location.search).get("control-room-tile") === "1";
const isMachineTracker = isControlRoomTile && new URLSearchParams(window.location.search).get("control-room-view") === "tracker";

if (isControlRoomTile) {
  document.documentElement.dataset.controlRoomTile = "true";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isControlRoom ? <ControlRoom /> : isMachineTracker ? <MachineTracker /> : <App />}
  </React.StrictMode>
);
