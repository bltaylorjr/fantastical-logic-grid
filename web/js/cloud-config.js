// Player accounts and save sync. Accounts stay switched off until both values
// are filled in, either here or at build time from the FLG_FIREBASE_API_KEY
// and FLG_CLOUD_URL environment variables (see server/README.md).
// The Firebase web API key is not a secret: it only names the project.
export const CLOUD = {
  firebaseApiKey: '',
  syncUrl: '',
  authUrl: 'https://identitytoolkit.googleapis.com/v1',
  tokenUrl: 'https://securetoken.googleapis.com/v1',
};

export const cloudEnabled = () => !!(CLOUD.firebaseApiKey && CLOUD.syncUrl);
