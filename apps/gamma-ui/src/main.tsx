import React from "react";
import ReactDOM from "react-dom/client";
import { Gamma } from "../components/Gamma";

// Default window spawning is handled inside Gamma after hydration.
// Do NOT call openWindow here — persist middleware reads localStorage
// synchronously, but calling store actions at module load time races
// with React's render cycle and causes duplicates on refresh.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Gamma />
  </React.StrictMode>
);
