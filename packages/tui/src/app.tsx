import { render } from "ink";
import { AppContainer, type InteractiveAppProps } from "./AppContainer.js";

export async function runInteractiveApp(options: InteractiveAppProps): Promise<void> {
  const app = render(<AppContainer {...options} />);
  await app.waitUntilExit();
}
