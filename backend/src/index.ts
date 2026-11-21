import app from "./app";
import { research_worker } from "./controllers/research";

const port = Number(process.env.PORT ?? 3001);
research_worker.start();
app.listen(port, () => console.log(`Express API listening on port ${port}`));
