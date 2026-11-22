import app from "./app";
import { research_worker } from "./controllers/research";
import { deck_preparation_worker } from "./controllers/deck";
import { website_walkthrough_worker } from "./routes/website-walkthrough";
import { site_run_worker } from "./routes/site-run";
import { mission_worker } from "./routes/mission";

const port = Number(process.env.PORT ?? 3001);
research_worker.start();
deck_preparation_worker.start();
website_walkthrough_worker.start();
site_run_worker.start();
mission_worker.start();
app.listen(port, () => console.log(`Express API listening on port ${port}`));
