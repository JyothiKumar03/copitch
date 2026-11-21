import app from "./app";
import { research_worker } from "./controllers/research";
import { deck_preparation_worker } from "./controllers/deck";
import { website_walkthrough_worker } from "./routes/website-walkthrough";

const port = Number(process.env.PORT ?? 3001);
research_worker.start();
deck_preparation_worker.start();
website_walkthrough_worker.start();
app.listen(port, () => console.log(`Express API listening on port ${port}`));
