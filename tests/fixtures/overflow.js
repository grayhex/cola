// What makes a page wider than the screen: null when it fits, otherwise the
// page width and the innermost elements sticking out on the right that no
// scrolling or clipping parent contains. Used by the e2e layout checks, so a
// failure names the element instead of only the page.
export function pageOverflow(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth <= width + 1) return null;
    const sticksOut = (element) =>
      element.getBoundingClientRect().right > width + 1;
    const contained = (element) => {
      for (
        let p = element.parentElement;
        p && p !== document.body;
        p = p.parentElement
      )
        if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    const elements = [...document.body.querySelectorAll("*")]
      .filter(
        (element) =>
          element.getBoundingClientRect().width > 0 &&
          sticksOut(element) &&
          ![...element.children].some(sticksOut) &&
          !contained(element),
      )
      .slice(0, 8)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const classes =
          typeof element.className === "string" && element.className.trim()
            ? "." + element.className.trim().split(/\s+/).join(".")
            : "";
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        return `${element.tagName.toLowerCase()}${classes} ${Math.round(box.left)}–${Math.round(box.right)} px «${text.slice(0, 50)}»`;
      });
    return { width, scrollWidth, elements };
  });
}

export function describeOverflow(overflow) {
  return (
    `шире экрана: ${overflow.scrollWidth} px при ширине ${overflow.width} px` +
    overflow.elements.map((element) => "\n      " + element).join("")
  );
}
