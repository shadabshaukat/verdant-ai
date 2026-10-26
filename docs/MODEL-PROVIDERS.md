# Chat model connections

Administrators configure profiles in Models. Save the profile, test its saved revision, then activate it. The test invokes a small native function call; a successful HTTP response containing only prose is insufficient. Editing endpoint, model or credentials invalidates the test and deactivates that profile until it is retested. One chat profile can be active; without one, the environment-configured Ollama model is used.

| Provider | Configuration | Authentication and constraints |
| --- | --- | --- |
| Ollama | Base URL and tool-capable model/tag | Local service or optional Bearer API key; native `/api/chat` |
| OpenAI-compatible | API base URL such as `https://api.openai.com/v1`, model ID | API key or explicitly unauthenticated private endpoint; native Chat Completions function tools required |
| Amazon Bedrock | AWS region, model/inference-profile ID, optional approved endpoint | AWS default credential chain or access key/secret/optional session token; official SDK Converse |
| OCI Generative AI | OCI region, compartment OCID, model ID, optional endpoint origin | Tenancy/user OCIDs, fingerprint and RSA PEM API signing key, optional passphrase; official SDK GENERIC chat with function tools |

Model availability and tool support depend on the exact account, region and model. OCI's adapter supports the GENERIC tool-capable interface; it does not pretend every model family uses the same wire format. The SDK adds its API version path, so an OCI override must be an origin rather than a URL already ending in a version path. Bedrock session tokens expire and must be refreshed by the deployment operator or the SDK's configured credential provider.

Remote endpoints require HTTPS. Known local Ollama addresses work over HTTP. Private-LAN HTTP requires the explicit `VERDANT_ALLOW_INSECURE_ENDPOINTS=true` opt-in. Redirects are rejected. Provider diagnostics omit upstream response bodies and credentials.

Credentials are encrypted in PostgreSQL and never returned by list/detail APIs. Empty credential inputs preserve the stored value when editing the same endpoint identity. Selecting a different provider/authentication/endpoint requires the corresponding credentials again. Do not put API keys in URLs or frontend source.

The selected provider receives bounded planner context, potentially including SQL text, operational evidence and recalled feedback. Review data handling before activation. Native tools remain validated by the application; provider output cannot become arbitrary SQL.

Embeddings are configured separately using `.env`. The default Nomic pipeline and stored vectors have 768 dimensions. Changing a chat profile never changes the stored embedding space. Keyword/structured search continues if embeddings are unavailable.

## Primary API references

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Amazon Bedrock client-side tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-client-side.html)
- [Amazon Bedrock Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [OCI TypeScript GENERIC chat request](https://docs.oracle.com/en-us/iaas/tools/typescript/latest/modules/_generativeaiinference_lib_model_generic_chat_request_.genericchatrequest.html)

SDK signing and serialization have controlled-transport regression tests. Real cloud inference acceptance requires valid account credentials, IAM permissions, entitlements and network access; a transport test does not establish those prerequisites.
