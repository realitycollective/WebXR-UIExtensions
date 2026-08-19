# Examples

Copy-paste starting points, shipped inside the npm package (Unity-style
`Examples/` convention, as used across Reality Collective packages).

| Example | Shows |
| --- | --- |
| [`basic-window/`](./basic-window) | A managed window with chrome, pin/minimize/close and body-follow |
| [`dock-regions/`](./dock-regions) | Layout regions, drop-to-dock, a follow-region "toolbar" |
| [`controls/`](./controls) | `data-uix` stepper, toggle, expandable label and log view |

Each example assumes an IWSDK app created with `npm create @iwsdk@latest`
(so the UIKitML Vite plugin is already wired: `.uikitml` files in `ui/`
compile to `public/ui/*.json`).

For a complete integrated application - five windows, two regions, a
registration form, event log, and horizon-kit Slider - see the `showcase/`
client in the repository, which deploys to Cloudflare Pages from CI.
