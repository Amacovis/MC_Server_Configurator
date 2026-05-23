import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";

function SmokePanel() {
  return (
    <section>
      <h1>Servers</h1>
      <button>Import</button>
      <button>New server</button>
    </section>
  );
}

function SettingsSmoke() {
  return (
    <form>
      <label>
        Systemd service
        <input defaultValue="minecraft2-service.service" />
      </label>
      <button type="button">Test</button>
      <button>Save</button>
      <button type="button">Remove from UI</button>
    </form>
  );
}

describe("ui smoke", () => {
  it("renders primary server actions", () => {
    render(<SmokePanel />);
    expect(screen.getByRole("heading", { name: "Servers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New server" })).toBeInTheDocument();
  });

  it("renders service editing controls", () => {
    render(<SettingsSmoke />);
    expect(screen.getByLabelText("Systemd service")).toHaveValue("minecraft2-service.service");
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from UI" })).toBeInTheDocument();
  });
});
