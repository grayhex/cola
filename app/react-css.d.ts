import "react";
// CSS custom properties are shared design tokens, with normal CSS keys still checked.
declare module "react" {
  interface CSSProperties {
    [name: `--${string}`]: string | number | undefined;
  }
}
