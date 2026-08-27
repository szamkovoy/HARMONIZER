package com.harmonizer.androidrestorecredentials

import android.os.Build
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreateRestoreCredentialRequest
import androidx.credentials.CreateRestoreCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetRestoreCredentialOption
import androidx.credentials.RestoreCredential
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.restorecredential.CreateRestoreCredentialDomException
import androidx.credentials.exceptions.restorecredential.E2eeUnavailableException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking

/**
 * Android Restore Credentials (Zero-Tap Sign-In) via Credential Manager.
 * Requires Android 9+ (API 28), GMS, androidx.credentials 1.5+.
 */
class AndroidRestoreCredentialsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AndroidRestoreCredentials")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
    }

    AsyncFunction("createRestoreCredential") { requestJson: String, cloudBackup: Boolean ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Activity not available", null)

      runBlocking {
        val credentialManager = CredentialManager.create(activity)
        try {
          createWithBackup(credentialManager, activity, requestJson, cloudBackup)
        } catch (e: E2eeUnavailableException) {
          if (cloudBackup) {
            createWithBackup(credentialManager, activity, requestJson, false)
          } else {
            throw CodedException("ERR_E2EE_UNAVAILABLE", e.message ?: "Cloud backup unavailable", e)
          }
        } catch (e: CreateRestoreCredentialDomException) {
          throw CodedException("ERR_INVALID_JSON", e.message ?: "Invalid WebAuthn JSON", e)
        } catch (e: CodedException) {
          throw e
        } catch (e: Exception) {
          throw CodedException("ERR_CREATE_FAILED", e.message ?: "Restore credential creation failed", e)
        }
      }
    }

    AsyncFunction("getRestoreCredential") { requestJson: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("ERR_NO_ACTIVITY", "Activity not available", null)

      runBlocking {
        val credentialManager = CredentialManager.create(activity)
        val getOption = GetRestoreCredentialOption(requestJson)
        val getRequest = GetCredentialRequest(listOf(getOption))
        try {
          val result = credentialManager.getCredential(activity, getRequest)
          val credential = result.credential
          if (credential is RestoreCredential) {
            credential.authenticationResponseJson
          } else {
            throw CodedException(
              "ERR_UNEXPECTED_CREDENTIAL",
              "Expected RestoreCredential, got ${credential::class.java.simpleName}",
              null,
            )
          }
        } catch (e: GetCredentialException) {
          // No restore key on this device — normal for first install / after logout.
          val type = e.type ?: ""
          if (type.contains("NO_CREDENTIAL", ignoreCase = true)) {
            null
          } else {
            throw CodedException("ERR_GET_FAILED", e.message ?: "Restore credential retrieval failed", e)
          }
        }
      }
    }

    AsyncFunction("clearRestoreCredentialState") {
      val activity = appContext.currentActivity ?: return@AsyncFunction null
      runBlocking {
        val credentialManager = CredentialManager.create(activity)
        credentialManager.clearCredentialState(ClearCredentialStateRequest())
      }
      null
    }
  }

  private suspend fun createWithBackup(
    credentialManager: CredentialManager,
    activity: android.app.Activity,
    requestJson: String,
    cloudBackup: Boolean,
  ): String {
    val request = CreateRestoreCredentialRequest(requestJson, cloudBackup)
    val response = credentialManager.createCredential(activity, request)
    if (response is CreateRestoreCredentialResponse) {
      return response.responseJson
    }
    throw CodedException("ERR_UNEXPECTED_RESPONSE", "Unexpected credential response type", null)
  }
}
