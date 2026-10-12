import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./themes.css";
import { readTheme } from "./themes";
document.documentElement.dataset.theme = readTheme();
createRoot(document.getElementById("root")!).render(<App />);
