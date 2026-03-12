import { useEffect, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useToast } from "./hooks/useToast";

export const UNAUTHORIZED_ROUTE_MESSAGE =
  "You do not have permission to access this page.";

const unauthorizedToastKeys = new Set<string>();

export function AccessDeniedRedirect({
  to = "/dashboard",
}: {
  to?: string;
}) {
  const location = useLocation();
  const toast = useToast();
  const toastKey = `${location.key}:${location.pathname}:${to}`;

  useEffect(() => {
    if (unauthorizedToastKeys.has(toastKey)) {
      return;
    }
    unauthorizedToastKeys.add(toastKey);
    toast.error(UNAUTHORIZED_ROUTE_MESSAGE);
  }, [toast, toastKey]);

  return <Navigate to={to} replace />;
}

export function guardRoute(
  allowed: boolean,
  element: ReactElement,
  redirectTo = "/dashboard",
): ReactElement {
  return allowed ? element : <AccessDeniedRedirect to={redirectTo} />;
}
