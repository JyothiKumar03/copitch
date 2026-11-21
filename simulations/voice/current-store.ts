import { SessionStore } from "../../backend/src/repositories/session";

const store = new SessionStore(":memory:");
store.add_session("fixture", "fixture_host");
const research = store.start("fixture", "Build the research brief", "");
const status = store.start("fixture", "How is research going?", "");
console.log({ research_accepted: Boolean(research), foreground_accepted: Boolean(status) });
