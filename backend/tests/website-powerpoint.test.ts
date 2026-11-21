import { expect, test } from "bun:test";
import { read_pptx } from "../src/services/source-pptx";
import { export_website_powerpoint } from "../src/services/website-powerpoint";

test("PowerPoint notes keep complete useful statements instead of breadcrumbs, headings, and clipped words", async () => {
  const url = "https://www.python.org/about/gettingstarted/";
  // This test reads slide text from the exported OOXML. The browser fixture covers the actual rendered image.
  const screenshot = Buffer.from("ffd8ffd9", "hex");
  const explanation = "Installing Python is generally easy, and many Linux and UNIX distributions include a recent Python.";
  const longer_excerpt = "Developers can compare the supported build options in this overview because every release lists tested platforms, archived installers and detailed documentation before installation begins";
  const deck = await export_website_powerpoint({
    url, audience: "Developers", goal: "Learn the basics of Python and download a supported version",
    pages: [
      {
        capture_id: 1, url, title: "Python For Beginners | Python.org", screenshot,
        facts: ["About>>>", "Python For Beginners", "Installing", "How to install a recent Python distribution",
          "Welcome! Are you completely new to programming? If not then we presume you want to get started with Python.",
          explanation + " Even some Windows computers come with Python already installed."],
      },
      { capture_id: 2, url: "https://www.python.org/downloads/", title: "Download Python", screenshot,
        facts: ["Installation Options", longer_excerpt] },
    ],
    attempts: [],
  });
  const { records } = await read_pptx(deck);
  expect(records[1].text).toContain(explanation);
  expect(records[1].text).toContain("Even some Windows computers come with Python already installed.");
  expect(records[1].text).not.toContain("About>>>");
  expect(records[1].text).not.toContain("What the page shows Installing Installing");
  expect(records[1].text).not.toContain("How to install a recent Python distribution");
  expect(records[1].text).not.toContain("Are you completely new to programming?");
  expect(records[2].text).toContain("archived installers and detailed…");
  expect(records[2].text).not.toContain("detailed do…");
  expect(records[2].text).not.toContain("Installation Options");
});
