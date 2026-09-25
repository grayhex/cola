// What makes a page wider than the screen: null when it fits, otherwise the
// page width and the elements sticking out on the right — the innermost
// ones, and scrolling or clipping boxes that stick out themselves — that no
// clipping parent within the screen holds. Used by the e2e layout checks, so
// a failure names the element instead of only the page.
export function pageOverflow(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth <= width + 1) return null;
    // An element's right edge, or where its content ends when that content
    // overflows the box and is not clipped (text, a select's chosen option).
    const sticksOut = (element) => {
      const box = element.getBoundingClientRect();
      const content =
        getComputedStyle(element).overflowX === "visible"
          ? box.left + (element.scrollWidth || box.width)
          : box.right;
      return Math.max(box.right, content) > width + 1;
    };
    const clips = (element) =>
      getComputedStyle(element).overflowX !== "visible";
    const held = (element) => {
      for (
        let p = element.parentElement;
        p && p !== document.body;
        p = p.parentElement
      )
        if (clips(p) && !sticksOut(p)) return true;
      return false;
    };
    const elements = [...document.body.querySelectorAll("*")]
      .filter(
        (element) =>
          element.getBoundingClientRect().width > 0 &&
          sticksOut(element) &&
          (clips(element) || ![...element.children].some(sticksOut)) &&
          !held(element),
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
