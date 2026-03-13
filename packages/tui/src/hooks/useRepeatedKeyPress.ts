import { useCallback, useEffect, useRef, useState } from "react";

export interface UseRepeatedKeyPressOptions {
  windowMs: number;
  onRepeat?: (count: number) => void;
  onReset?: () => void;
}

export function useRepeatedKeyPress(options: UseRepeatedKeyPressOptions) {
  const [pressCount, setPressCount] = useState(0);
  const pressCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const resetCount = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (pressCountRef.current > 0) {
      pressCountRef.current = 0;
      setPressCount(0);
      optionsRef.current.onReset?.();
    }
  }, []);

  const handlePress = useCallback(() => {
    const newCount = pressCountRef.current + 1;
    pressCountRef.current = newCount;
    setPressCount(newCount);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      pressCountRef.current = 0;
      setPressCount(0);
      timerRef.current = null;
      optionsRef.current.onReset?.();
    }, optionsRef.current.windowMs);

    optionsRef.current.onRepeat?.(newCount);
    return newCount;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    pressCount,
    handlePress,
    resetCount
  };
}
