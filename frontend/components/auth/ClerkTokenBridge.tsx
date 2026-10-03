"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setTokenProvider } from "@/lib/api/client";

/**
 * Bridges Clerk's session token into the API client.
 *
 * The client deliberately has no Clerk import so it stays testable in isolation;
 * this component is the single place the two are joined. `getToken` is read
 * lazily on each request rather than captured once, so a token refresh is picked
 * up without remounting anything.
 *
 * Renders nothing.
 */
export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    // Before Clerk loads, `getToken` throws rather than resolving to null, so
    // the provider is only registered once a session is available.
    if (!isLoaded) return;

    setTokenProvider(async () => {
      try {
        return await getToken();
      } catch {
        // A throw here would reject every request with a confusing error. A
        // null token instead produces a clean 401 the caller can act on.
        return null;
      }
    });

    return () => setTokenProvider(() => null);
  }, [getToken, isLoaded]);

  return null;
}