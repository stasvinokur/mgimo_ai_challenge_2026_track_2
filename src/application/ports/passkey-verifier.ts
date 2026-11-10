export interface PasskeyDescriptor {
  id: string;
  transports?: string[];
}

export interface PasskeyCredential extends PasskeyDescriptor {
  publicKey: string;
  counter: number;
}

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout: number;
  attestation: "none";
  excludeCredentials: (PasskeyDescriptor & { type: "public-key" })[];
  authenticatorSelection: {
    residentKey: "required";
    userVerification: "required";
  };
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  allowCredentials: (PasskeyDescriptor & { type: "public-key" })[];
  userVerification: "required";
}

interface PasskeyResponse {
  id: string;
  rawId: string;
  type: "public-key";
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: "platform" | "cross-platform";
}

export interface PasskeyRegistrationResponse extends PasskeyResponse {
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

export interface PasskeyAuthenticationResponse extends PasskeyResponse {
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

export type PasskeyRegistrationResult =
  | { verified: true; credential: PasskeyCredential }
  | { verified: false };

export type PasskeyAuthenticationResult =
  | { verified: true; credentialId: string; newCounter: number }
  | { verified: false };

export interface PasskeyVerifier {
  registrationOptions(input: {
    userId: string;
    userName: string;
    existingCredentials: PasskeyDescriptor[];
  }): Promise<PasskeyRegistrationOptions>;
  authenticationOptions(input: {
    credentials: PasskeyDescriptor[];
  }): Promise<PasskeyAuthenticationOptions>;
  verifyRegistration(input: {
    response: PasskeyRegistrationResponse;
    expectedChallengeHash: string;
  }): Promise<PasskeyRegistrationResult>;
  verifyAuthentication(input: {
    response: PasskeyAuthenticationResponse;
    expectedChallengeHash: string;
    credential: PasskeyCredential;
  }): Promise<PasskeyAuthenticationResult>;
}
