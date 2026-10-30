import { motion } from "framer-motion";
import { SparklesIcon } from "lucide-react";

export const Greeting = () => (
  <div className="flex flex-col items-center px-4" key="overview">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-primary"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.15, duration: 0.45 }}
    >
      <SparklesIcon aria-hidden="true" className="size-3.5" />
      Grace AI <span className="text-muted-foreground/60">/ by Ritam Das</span>
    </motion.div>
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      Hello, what’s on your mind?
    </motion.div>
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 text-center text-muted-foreground/80 text-sm"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      A space to think, create, and figure things out. Start anywhere.
    </motion.div>
  </div>
);
