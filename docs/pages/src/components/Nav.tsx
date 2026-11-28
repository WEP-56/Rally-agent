import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "../utils/cn";
import { useTheme } from "../theme";
import { VERSION } from "../data";
import { GitHubIcon, MoonIcon, SunIcon, SPRING_JELLY } from "./ui";

const LINKS = [
  { href: "#workstation", label: "数字工位" },
  { href: "#critters", label: "小家伙" },
  { href: "#connect", label: "连接" },
  { href: "#architecture", label: "架构" },
  { href: "#deploy", label: "带回家" },
  { href: "#github", label: "GitHub" },
];

export function Nav() {
  const { dark, toggleDark } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
      <motion.nav
        initial={{ y: -70, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...SPRING_JELLY, delay: 0.1 }}
        className={cn(
          "flex w-full max-w-6xl items-center gap-1 rounded-full border py-2 pr-2 pl-3 transition-all duration-300 sm:gap-2 sm:pl-4",
          scrolled
            ? "border-md-outline-variant/60 bg-md-surface-lowest/85 shadow-float backdrop-blur-xl"
            : "border-transparent bg-transparent",
        )}
      >
        <a href="#top" className="state-layer flex items-center gap-2.5 rounded-full py-1 pr-3">
          <motion.img
            src={`${import.meta.env.BASE_URL}images/rally-favicon.png`}
            alt="Rally"
            className="h-9 w-9 rounded-[12px]"
            whileHover={{ rotate: [-0, -10, 8, 0], scale: 1.08 }}
            transition={SPRING_JELLY}
          />
          <span className="font-display text-xl font-extrabold tracking-tight text-md-on-surface">Rally</span>
          <span className="font-display hidden rounded-full bg-md-tertiary-container px-2 py-0.5 text-[11px] font-bold text-md-on-tertiary-container sm:inline">
            {VERSION}
          </span>
        </a>

        <div className="ml-auto hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="state-layer rounded-full px-3.5 py-2 text-[13.5px] font-bold text-md-on-surface-variant transition-colors hover:text-md-on-surface"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5 md:ml-2">
          <motion.button
            type="button"
            onClick={toggleDark}
            aria-label="切换深浅主题"
            initial={false}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            transition={SPRING_JELLY}
            className="state-layer relative flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-md-surface-high text-md-on-surface-variant"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={dark ? "moon" : "sun"}
                initial={{ y: 14, opacity: 0, rotate: -40 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: -14, opacity: 0, rotate: 40 }}
                transition={SPRING_JELLY}
                className="flex"
              >
                {dark ? <MoonIcon className="h-[18px] w-[18px]" /> : <SunIcon className="h-[18px] w-[18px]" />}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <motion.a
            href="https://github.com/WEP-56/Rally-agent"
            target="_blank"
            rel="noreferrer"
            initial={false}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_JELLY}
            className="state-layer font-display hidden items-center gap-2 rounded-full bg-md-primary px-4.5 py-2.5 text-[13.5px] font-bold text-md-on-primary shadow-jelly sm:inline-flex"
          >
            <GitHubIcon className="h-4.5 w-4.5" />
            去看看
          </motion.a>
        </div>
      </motion.nav>
    </header>
  );
}
