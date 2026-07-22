#!/usr/bin/env node
/**
 * Upload FCM V1 Google Service Account key to EAS and assign it to
 * com.zamkovoi.harmonizer for Expo Push (Android).
 *
 * Requires: logged-in `eas` session (~/.expo/state.json) and
 * ./fcm-service-account.json in the repo root.
 *
 * Does not print private key material.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "com.zamkovoi.harmonizer";
const PROJECT_FULL_NAME = "@zamkovoi/harmonizer";
const GRAPHQL = "https://api.expo.dev/graphql";

function loadSession() {
  const statePath = path.join(os.homedir(), ".expo", "state.json");
  if (!fs.existsSync(statePath)) {
    throw new Error(`No Expo session at ${statePath}. Run: eas login`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const sessionSecret = state?.auth?.sessionSecret;
  const accessToken = state?.auth?.accessToken ?? process.env.EXPO_TOKEN;
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }
  if (sessionSecret) {
    return { "expo-session": sessionSecret };
  }
  throw new Error("Expo session has no accessToken/sessionSecret. Run: eas login");
}

async function gql(headers, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Expo GraphQL error: ${msg}`);
  }
  return json.data;
}

async function main() {
  const keyPath = path.join(root, "fcm-service-account.json");
  if (!fs.existsSync(keyPath)) {
    throw new Error("Missing fcm-service-account.json in repo root");
  }
  const jsonKey = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  if (jsonKey.type !== "service_account" || !jsonKey.private_key) {
    throw new Error("fcm-service-account.json is not a valid service account key");
  }

  const headers = loadSession();
  console.log(`Uploading FCM V1 key for ${PROJECT_FULL_NAME} / ${PACKAGE}…`);
  console.log(`Service account: ${jsonKey.client_email}`);

  const appData = await gql(
    headers,
    `query AppByFullName($fullName: String!) {
      app {
        byFullName(fullName: $fullName) {
          id
          fullName
          ownerAccount { id name }
        }
      }
    }`,
    { fullName: PROJECT_FULL_NAME },
  );
  const app = appData?.app?.byFullName;
  if (!app?.id || !app.ownerAccount?.id) {
    throw new Error(`App ${PROJECT_FULL_NAME} not found for this Expo session`);
  }

  const existing = await gql(
    headers,
    `query AndroidCreds($fullName: String!, $applicationIdentifier: String!) {
      app {
        byFullName(fullName: $fullName) {
          androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier }) {
            id
            googleServiceAccountKeyForFcmV1 {
              id
              clientEmail
              projectIdentifier
            }
          }
        }
      }
    }`,
    { fullName: PROJECT_FULL_NAME, applicationIdentifier: PACKAGE },
  );
  const credsList = existing?.app?.byFullName?.androidAppCredentials ?? [];
  let appCredentials = credsList[0] ?? null;

  if (appCredentials?.googleServiceAccountKeyForFcmV1?.clientEmail === jsonKey.client_email) {
    console.log(
      `✓ FCM V1 already assigned (${appCredentials.googleServiceAccountKeyForFcmV1.clientEmail})`,
    );
    return;
  }

  const created = await gql(
    headers,
    `mutation CreateGsa($googleServiceAccountKeyInput: GoogleServiceAccountKeyInput!, $accountId: ID!) {
      googleServiceAccountKey {
        createGoogleServiceAccountKey(
          googleServiceAccountKeyInput: $googleServiceAccountKeyInput
          accountId: $accountId
        ) {
          id
          clientEmail
          projectIdentifier
        }
      }
    }`,
    {
      accountId: app.ownerAccount.id,
      googleServiceAccountKeyInput: { jsonKey },
    },
  );
  const gsa = created?.googleServiceAccountKey?.createGoogleServiceAccountKey;
  if (!gsa?.id) throw new Error("createGoogleServiceAccountKey returned no id");
  console.log(`✓ Uploaded key id=${gsa.id} (${gsa.clientEmail})`);

  if (!appCredentials) {
    const createdCreds = await gql(
      headers,
      `mutation CreateAndroidCreds($appId: ID!, $applicationIdentifier: String!) {
        androidAppCredentials {
          createAndroidAppCredentials(
            androidAppCredentialsInput: {}
            appId: $appId
            applicationIdentifier: $applicationIdentifier
          ) { id }
        }
      }`,
      { appId: app.id, applicationIdentifier: PACKAGE },
    );
    appCredentials = createdCreds?.androidAppCredentials?.createAndroidAppCredentials;
    if (!appCredentials?.id) throw new Error("createAndroidAppCredentials failed");
    console.log(`✓ Created Android app credentials ${appCredentials.id}`);
  }

  const assigned = await gql(
    headers,
    `mutation AssignFcmV1($androidAppCredentialsId: ID!, $googleServiceAccountKeyId: ID!) {
      androidAppCredentials {
        setGoogleServiceAccountKeyForFcmV1(
          id: $androidAppCredentialsId
          googleServiceAccountKeyId: $googleServiceAccountKeyId
        ) {
          id
          googleServiceAccountKeyForFcmV1 {
            id
            clientEmail
            projectIdentifier
          }
        }
      }
    }`,
    {
      androidAppCredentialsId: appCredentials.id,
      googleServiceAccountKeyId: gsa.id,
    },
  );
  const assignedKey =
    assigned?.androidAppCredentials?.setGoogleServiceAccountKeyForFcmV1
      ?.googleServiceAccountKeyForFcmV1;
  if (!assignedKey?.id) throw new Error("setGoogleServiceAccountKeyForFcmV1 failed");
  console.log(
    `✓ Assigned FCM V1 for ${PACKAGE}: ${assignedKey.clientEmail} (project ${assignedKey.projectIdentifier})`,
  );
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
