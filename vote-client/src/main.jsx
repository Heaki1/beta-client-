import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// The site-wide theme is served by Express from public/Bountiestyl.css.
// It's attached at runtime rather than linked in index.html so the Vite
// build never has to resolve a file that lives outside this project.
function attachSiteTheme() {
  const href = "/Bountiestyl.css";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.prepend(link);
}

attachSiteTheme();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
