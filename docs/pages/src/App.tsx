import { ThemeProvider } from "./theme";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Ticker } from "./components/Ticker";
import { WorkstationSection } from "./sim/Workstation";
import { Critters } from "./components/Critters";
import { Connections } from "./components/Connections";
import { Design } from "./components/Design";
import { Architecture } from "./components/Architecture";
import { Deploy } from "./components/Deploy";
import { Community, Footer } from "./components/Community";

export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen">
        <Nav />
        <main>
          <Hero />
          <Ticker />
          <WorkstationSection />
          <Critters />
          <Connections />
          <Design />
          <Architecture />
          <Deploy />
          <Community />
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
