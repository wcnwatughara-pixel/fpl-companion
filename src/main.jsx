/**
 * main.jsx -- Application entry point
 *
 * This is the file Vite loads first. It renders the App component
 * into the #root div in index.html.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
