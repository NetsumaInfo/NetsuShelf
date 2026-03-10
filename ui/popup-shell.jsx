import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function readText(id, fallback = "") {
    const element = document.getElementById(id);
    if (!element) {
        return fallback;
    }

    const value = (element.textContent || "").trim();
    return value === "" ? fallback : value;
}

function clickAndScroll(buttonId, sectionId) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.click();
    }

    if (sectionId) {
        setTimeout(() => {
            const section = document.getElementById(sectionId);
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 120);
    }
}

function isDefaultParser(parserName) {
    return (parserName || "").toLowerCase().includes("defaultparser");
}

function readThemeMode() {
    const select = document.getElementById("themeColorTag");
    return select ? select.value : "";
}

function applyThemeMode(nextThemeMode) {
    const select = document.getElementById("themeColorTag");
    if (!select) {
        return;
    }

    select.value = nextThemeMode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
}

function getThemeToggleLabel(themeMode) {
    return themeMode === "DarkMode" ? "Switch to light mode" : "Switch to dark mode";
}

function ThemeToggleIcon({ themeMode }) {
    if (themeMode === "DarkMode") {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm8-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1Zm-15 0a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2h1Zm11.95 5.54a1 1 0 1 1 1.41 1.41l-.7.71a1 1 0 1 1-1.42-1.41l.71-.71ZM8.16 7.76a1 1 0 0 1 0 1.41l-.71.7a1 1 0 1 1-1.41-1.4l.7-.71a1 1 0 0 1 1.42 0Zm8.49-1.41a1 1 0 0 1 1.41 1.4l-.71.71a1 1 0 0 1-1.41-1.41l.71-.7ZM8.16 16.24a1 1 0 0 1 0 1.41l-.71.71a1 1 0 1 1-1.41-1.42l.7-.7a1 1 0 0 1 1.42 0Z" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M13.9 2.52a1 1 0 0 1 .33 1.1 8 8 0 1 0 10.14 10.14 1 1 0 0 1 1.1.33 1 1 0 0 1-.1 1.35A10 10 0 1 1 12.55 2.62a1 1 0 0 1 1.35-.1Z" />
        </svg>
    );
}

function PopupShell() {
    const [parserName, setParserName] = useState(() => readText("spanParserName", "Auto"));
    const [themeMode, setThemeMode] = useState(() => readThemeMode());

    useEffect(() => {
        const refresh = () => {
            setParserName(readText("spanParserName", "Auto"));
        };

        refresh();
        const timer = window.setInterval(refresh, 600);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const refresh = () => {
            setThemeMode(readThemeMode());
        };

        refresh();
        const timer = window.setInterval(refresh, 800);
        return () => window.clearInterval(timer);
    }, []);

    const toggleTheme = () => {
        const nextThemeMode = themeMode === "DarkMode" ? "LightMode" : "DarkMode";
        applyThemeMode(nextThemeMode);
        setThemeMode(nextThemeMode);
    };

    return (
        <div className="shell-panel shell-panel-minimal">
            <div className="shell-tools">
                {isDefaultParser(parserName) && (
                    <button
                        type="button"
                        className="shell-btn shell-btn-primary"
                        onClick={() => clickAndScroll("autoDetectDefaultParserButton", "defaultParserSection")}
                    >
                        Auto Detect Parser
                    </button>
                )}
                <button
                    type="button"
                    className="shell-btn shell-btn-icon"
                    onClick={toggleTheme}
                    title={getThemeToggleLabel(themeMode)}
                    aria-label={getThemeToggleLabel(themeMode)}
                >
                    <ThemeToggleIcon themeMode={themeMode} />
                </button>
            </div>
        </div>
    );
}

const mountPoint = document.getElementById("reactShellMount");
if (mountPoint) {
    createRoot(mountPoint).render(<PopupShell />);
}
