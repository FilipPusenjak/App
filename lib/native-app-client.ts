"use client";

// The client-side half of lib/native-app.ts: whether this page is running
// inside the CourseChart app, read from the same user-agent marker.
//
// useSyncExternalStore rather than useState + useEffect: the server renders
// "not in the app" (it has no navigator), and React swaps in the client's
// answer after hydration without a mismatch warning or an effect.
import { useSyncExternalStore } from "react";
import { NATIVE_APP_MARKER } from "./native-app-marker";

const subscribe = () => () => {};

export function useInNativeApp(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.userAgent.includes(NATIVE_APP_MARKER),
    () => false,
  );
}
