/** "collections deleted" webhook -> store activity log (see app/utils/deleteWebhook.server.js). */
import { handleDeleteWebhook } from "../utils/deleteWebhook.server";

export const action = ({ request }) => handleDeleteWebhook(request, { kind: "collection", subjectType: "COLLECTION", titleOf: (p) => p?.title });
