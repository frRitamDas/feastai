// components/grokbot-selector.tsx
'use client';

import React from 'react';
import { Compass, BookOpen, Wrench, Sparkles, Palette, DollarSign, Store, Search } from 'lucide-react';

export const ACTUAL_GROKBOTS = [
  { name: 'Captain SmartPickShop USA', handle: 'captain', icon: Compass, model: 'deepseek-r1-distill-llama-70b', desc: 'Master Orchestrator & Task Commander' },
  { name: 'The Mayor', handle: 'the-mayor', icon: BookOpen, model: 'llama-3.3-70b-versatile', desc: 'Master Ledger Keeper & Canon Register' },
  { name: 'Dr. Finkelstein', handle: 'dr-finkel', icon: Wrench, model: 'qwen-2.5-coder-32b', desc: 'Site Smith & Code Architect' },
  { name: 'Jack Skelly', handle: 'jack-skelly', icon: Sparkles, model: 'llama-3.3-70b-versatile', desc: 'Brand Forge & Steampunk Neon Canon' },
  { name: 'Sally', handle: 'sally', icon: Palette, model: 'gemini-2.5-flash', desc: 'Art Foundry & 4-Gear Visual Assets' },
  { name: 'Oogie Boogie', handle: 'oogie', icon: DollarSign, model: 'deepseek-r1-distill-llama-70b', desc: 'Sales Forge & Offer Architecture' },
  { name: 'Zero', handle: 'zero', icon: Store, model: 'llama-3.3-70b-versatile', desc: 'Site Overseer & Feature Builder' },
  { name: 'Sprock', handle: 'sprock', icon: Search, model: 'gemini-2.5-flash', desc: 'Context Sweeper & Drive Auditor' },
];

export function GrokBotSelector({ onSelectBot }: { onSelectBot: (bot: any) => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2.5 px-4 border-b border-zinc-800 bg-black/60 backdrop-blur sticky top-0 z-20">
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider pl-1 mr-1">
        GrokBots:
      </span>
      {ACTUAL_GROKBOTS.map((bot) => {
        const Icon = bot.icon;
        return (
          <button
            key={bot.handle}
            onClick={() => onSelectBot(bot)}
            title={bot.desc}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition whitespace-nowrap shadow-sm"
          >
            <Icon className="w-3.5 h-3.5 text-yellow-400" />
            <span className="font-medium">{bot.name}</span>
          </button>
        );
      })}
    </div>
  );
}
