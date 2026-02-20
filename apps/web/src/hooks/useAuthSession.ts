import { useCallback, useEffect, useState } from 'react';
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import {
  fetchCurrentUser,
  getDemoUserEmail,
  setAuthToken,
  setDemoUserEmail,
  syncCurrentUserProfile,
  type CurrentUserSession,
  type MicrosoftGraphProfile,
} from '../api/client';

type AuthState = {
  loading: boolean;
  user: CurrentUserSession | null;
  error: string | null;
};

type ResolvedTokens = {
  idToken: string;
  graphAccessToken: string | null;
};

type GraphProfilePayload = {
  profile: MicrosoftGraphProfile | null;
  avatarDataUrl: string | null;
};

const tenantId = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const redirectUri =
  (import.meta.env.VITE_AZURE_REDIRECT_URI as string | undefined) ??
  window.location.origin;
const logoutRedirectUri =
  (import.meta.env.VITE_AZURE_LOGOUT_REDIRECT_URI as string | undefined) ??
  window.location.origin;

const oidcScopes = ['openid', 'profile', 'email'];
const graphScopes = ['User.Read'];
const loginRequest = {
  scopes: [...oidcScopes, ...graphScopes],
};
const graphRequest = {
  scopes: graphScopes,
};
const oidcRequest = {
  scopes: oidcScopes,
};

const graphProfileFields = [
  'id',
  'displayName',
  'givenName',
  'surname',
  'userPrincipalName',
  'mail',
  'jobTitle',
  'mobilePhone',
  'businessPhones',
  'officeLocation',
  'preferredLanguage',
  'department',
  'companyName',
  'employeeId',
  'employeeType',
  'city',
  'state',
  'country',
  'postalCode',
  'streetAddress',
  'usageLocation',
  'mailNickname',
].join(',');

const graphProfileEndpoint = `https://graph.microsoft.com/v1.0/me?$select=${graphProfileFields}`;
const graphPhotoEndpoint = 'https://graph.microsoft.com/v1.0/me/photo/$value';
const isE2EMode = import.meta.env.VITE_E2E_MODE === 'true';

let msalClient: PublicClientApplication | null = null;

function getMsalClient() {
  if (!tenantId || !clientId) {
    return null;
  }
  if (msalClient) {
    return msalClient;
  }
  msalClient = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
      postLogoutRedirectUri: logoutRedirectUri,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  });
  return msalClient;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null);
}

function normalizeGraphProfile(raw: unknown): MicrosoftGraphProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const id = asString(data.id);
  if (!id) {
    return null;
  }

  return {
    id,
    displayName: asString(data.displayName),
    givenName: asString(data.givenName),
    surname: asString(data.surname),
    userPrincipalName: asString(data.userPrincipalName),
    mail: asString(data.mail),
    jobTitle: asString(data.jobTitle),
    mobilePhone: asString(data.mobilePhone),
    businessPhones: asStringArray(data.businessPhones),
    officeLocation: asString(data.officeLocation),
    preferredLanguage: asString(data.preferredLanguage),
    department: asString(data.department),
    companyName: asString(data.companyName),
    employeeId: asString(data.employeeId),
    employeeType: asString(data.employeeType),
    city: asString(data.city),
    state: asString(data.state),
    country: asString(data.country),
    postalCode: asString(data.postalCode),
    streetAddress: asString(data.streetAddress),
    usageLocation: asString(data.usageLocation),
    mailNickname: asString(data.mailNickname),
  };
}

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to convert image to data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

async function fetchGraphProfile(
  graphAccessToken: string | null,
): Promise<GraphProfilePayload> {
  if (!graphAccessToken) {
    return { profile: null, avatarDataUrl: null };
  }

  const authHeader = { Authorization: `Bearer ${graphAccessToken}` };

  let profile: MicrosoftGraphProfile | null = null;
  try {
    const profileResponse = await fetch(graphProfileEndpoint, {
      headers: authHeader,
    });
    if (profileResponse.ok) {
      const payload = await profileResponse.json();
      profile = normalizeGraphProfile(payload);
    }
  } catch {
    profile = null;
  }

  let avatarDataUrl: string | null = null;
  try {
    const photoResponse = await fetch(graphPhotoEndpoint, {
      headers: authHeader,
    });
    if (photoResponse.ok) {
      const blob = await photoResponse.blob();
      avatarDataUrl = await toDataUrl(blob);
    }
  } catch {
    avatarDataUrl = null;
  }

  return { profile, avatarDataUrl };
}

async function resolveTokens(
  client: PublicClientApplication,
  redirectResult: AuthenticationResult | null,
  account: AccountInfo,
): Promise<ResolvedTokens> {
  let idToken = redirectResult?.idToken ?? '';
  let graphAccessToken = redirectResult?.accessToken ?? null;

  if (!idToken) {
    const oidcResult = await client.acquireTokenSilent({
      ...oidcRequest,
      account,
    });
    idToken = oidcResult.idToken;
  }

  if (!graphAccessToken) {
    const graphResult = await client.acquireTokenSilent({
      ...graphRequest,
      account,
    });
    graphAccessToken = graphResult.accessToken;
    if (!idToken && graphResult.idToken) {
      idToken = graphResult.idToken;
    }
  }

  if (!idToken) {
    throw new Error('Failed to acquire ID token');
  }

  return { idToken, graphAccessToken };
}

export function useAuthSession() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    user: null,
    error: null,
  });

  const signIn = useCallback(async () => {
    if (isE2EMode) {
      setState((prev) => ({
        ...prev,
        error: 'E2E mode uses a preselected demo persona. Set demoUserEmail before loading the app.',
      }));
      return;
    }
    const client = getMsalClient();
    if (!client) {
      setState((prev) => ({
        ...prev,
        error:
          'Missing Azure auth configuration. Set VITE_AZURE_TENANT_ID and VITE_AZURE_CLIENT_ID.',
      }));
      return;
    }
    await client.loginRedirect(loginRequest);
  }, []);

  const signOut = useCallback(async () => {
    if (isE2EMode) {
      setAuthToken(null);
      setDemoUserEmail('');
      setState({ loading: false, user: null, error: null });
      return;
    }
    const client = getMsalClient();
    setAuthToken(null);
    setDemoUserEmail('');
    if (!client) {
      setState({ loading: false, user: null, error: null });
      return;
    }
    await client.logoutRedirect({
      postLogoutRedirectUri: logoutRedirectUri,
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      if (isE2EMode) {
        try {
          const email = getDemoUserEmail().toLowerCase();
          if (!email) {
            if (isMounted) {
              setState({
                loading: false,
                user: null,
                error: 'Missing demo persona. Set demoUserEmail before opening the app in E2E mode.',
              });
            }
            return;
          }

          setAuthToken(null);
          setDemoUserEmail(email);
          const me = await fetchCurrentUser();
          const sessionUser: CurrentUserSession = {
            ...me.data,
            graphProfile: null,
            avatarDataUrl: null,
          };
          if (isMounted) {
            setState({
              loading: false,
              user: sessionUser,
              error: null,
            });
          }
        } catch (error) {
          if (isMounted) {
            setState({
              loading: false,
              user: null,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to initialize E2E authentication session',
            });
          }
        }
        return;
      }

      const client = getMsalClient();
      if (!client) {
        if (isMounted) {
          setState({
            loading: false,
            user: null,
            error:
              'Missing Azure auth configuration. Set VITE_AZURE_TENANT_ID and VITE_AZURE_CLIENT_ID.',
          });
        }
        return;
      }

      try {
        await client.initialize();
        const redirectResult = await client.handleRedirectPromise();
        const account =
          redirectResult?.account ??
          client.getActiveAccount() ??
          client.getAllAccounts()[0] ??
          null;

        if (!account) {
          if (isMounted) {
            setAuthToken(null);
            setDemoUserEmail('');
            setState({ loading: false, user: null, error: null });
          }
          return;
        }

        client.setActiveAccount(account);

        let tokens: ResolvedTokens;
        try {
          tokens = await resolveTokens(client, redirectResult, account);
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            await client.loginRedirect(loginRequest);
            return;
          }
          throw error;
        }

        setAuthToken(tokens.idToken);

        const [me, graphProfile] = await Promise.all([
          fetchCurrentUser(),
          fetchGraphProfile(tokens.graphAccessToken),
        ]);

        if (graphProfile.profile) {
          await syncCurrentUserProfile(graphProfile.profile).catch(() => undefined);
        }

        const normalizedEmail = (me.data.email || account.username || '').toLowerCase();
        if (normalizedEmail) {
          setDemoUserEmail(normalizedEmail);
        } else {
          setDemoUserEmail('');
        }

        const sessionUser: CurrentUserSession = {
          ...me.data,
          graphProfile: graphProfile.profile,
          avatarDataUrl: graphProfile.avatarDataUrl,
        };

        if (isMounted) {
          setState({
            loading: false,
            user: sessionUser,
            error: null,
          });
        }
      } catch (error) {
        if (isMounted) {
          setAuthToken(null);
          setDemoUserEmail('');
          setState({
            loading: false,
            user: null,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to initialize Microsoft authentication',
          });
        }
      }
    };

    void initialize();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    loading: state.loading,
    user: state.user,
    error: state.error,
    signIn,
    signOut,
  } as const;
}
