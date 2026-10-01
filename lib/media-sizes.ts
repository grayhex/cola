// Closed sets shared by image encoding and HTTP validation. Large variants
// are opt-in for site graphics; ordinary photo routes keep their own budget.
export const mediaWidths = Object.freeze([160, 320, 640, 1280]);
export const siteGraphicWidths = Object.freeze([...mediaWidths, 1920, 2400]);
export const heroWidths = Object.freeze([640, 1280, 1920, 2400]);
