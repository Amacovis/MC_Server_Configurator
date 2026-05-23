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

describe("ui smoke", () => {
  it("renders primary server actions", () => {
    render(<SmokePanel />);
    expect(screen.getByRole("heading", { name: "Servers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New server" })).toBeInTheDocument();
  });
});

