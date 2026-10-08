/**
 * The demos' app service - one Service Framework service, the same class on
 * every platform the showcase, the lab and the devtools playground run on.
 *
 * Each platform file builds the Service Framework runtime for its engine (the
 * three.js `WebXRRuntimeAdapter` on the desktop page and under XR Blocks, the
 * IWSDK bridge under IWSDK) and registers this service with it. The adapter
 * owns or relays the frame tick and the manager forwards it here as
 * `render()`, which runs the platform's `frame` closure: that is where the UI
 * Extensions binding is ticked and, where the page owns the drawing, the
 * scene is rendered.
 *
 * Engine objects (the renderer, the scene, the camera, `xb`, the IWSDK World)
 * stay in the platform file and reach this service only through `frame`, so
 * nothing here imports an engine. It also reports what the platform can do -
 * the adapter's capabilities and the XR session's state - to the playground's
 * Event Log window.
 */
import {
  BaseService,
  createServiceToken,
  type AdapterCapabilities,
  type LifecycleContext,
  type RuntimeAdapter,
  type ServiceRegistration,
  type Unsubscribe,
} from '@realitycollective/service-framework';

export interface UixAppConfig {
  /** The platform's runtime adapter: capabilities and, where the host owns one, the XR session. */
  readonly adapter: RuntimeAdapter;
  /**
   * Per-frame work: tick the UI Extensions binding and draw. Called from
   * `render()` once per frame the adapter lets through, with the frame's
   * delta in seconds (the scheduler's `deltaTime` is milliseconds).
   */
  readonly frame: (deltaSeconds: number, context: LifecycleContext) => void;
  /** Where platform facts go: the playground's Event Log window. */
  readonly report: (line: string) => void;
}

/** One line for the Event Log. Plain ASCII: the panel font has no arrows. */
function describeCapabilities(capabilities: AdapterCapabilities): string {
  const flag = (on: boolean): string => (on ? 'yes' : 'no');
  return (
    `capabilities: immersive ${flag(capabilities.immersive)}, ` +
    `hands ${flag(capabilities.handTracking)}, ` +
    `planes ${flag(capabilities.planeDetection)}, ` +
    `passthrough ${flag(capabilities.passthrough)}, ` +
    `blend ${capabilities.environmentBlendMode ?? 'none'}`
  );
}

export class UixAppService extends BaseService<UixAppConfig> {
  private readonly subscriptions: Unsubscribe[] = [];

  public override start(): void {
    const { adapter, report } = this.serviceConfig;
    report(describeCapabilities(adapter.getCapabilities()));
    this.subscriptions.push(
      adapter.onCapabilitiesChange((capabilities) => report(describeCapabilities(capabilities))),
    );
    const session = adapter.session;
    if (session) {
      this.subscriptions.push(session.onStateChange((state) => report(`XR session ${state}`)));
    }
  }

  public override render(context: LifecycleContext): void {
    this.serviceConfig.frame(context.deltaTime / 1000, context);
  }

  public override destroy(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
  }
}

export const UIX_APP_TOKEN = createServiceToken<UixAppService>('UixAppService');

/**
 * The app service's entry for `createServiceProfile`. A profile takes
 * `ServiceRegistration` with its config typed `unknown`, which a service with
 * a typed config does not fit under strict function types; the entry is typed
 * in full here and widened once, as the Service Framework's own examples do.
 */
export function uixAppRegistration(config: UixAppConfig): ServiceRegistration {
  const registration: ServiceRegistration<UixAppService, UixAppConfig> = {
    token: UIX_APP_TOKEN,
    config,
    useClass: UixAppService,
  };
  return registration as unknown as ServiceRegistration;
}
