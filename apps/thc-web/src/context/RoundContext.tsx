import { createContext, useContext } from 'react';
import { useCaptionCrewRound } from '@/hooks/useCaptionCrewRound';

type RoundContextValue = ReturnType<typeof useCaptionCrewRound>;
const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundContextProvider({ children }: { children: React.ReactNode }) {
  const round = useCaptionCrewRound();
  return <RoundContext.Provider value={round}>{children}</RoundContext.Provider>;
}

export function useRoundContext(): RoundContextValue {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error('useRoundContext must be inside RoundContextProvider');
  return ctx;
}
