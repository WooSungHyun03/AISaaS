/** Google OAuth scopes for the YouTube connection. Plain constants so client components can read them too. */
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** channels.list?mine=true (who owns this login) is not allowed under the upload scope alone. */
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
/** YouTube Analytics reports.query for the owner's own channel (views, watch time, subscribers). */
export const YOUTUBE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
/** Asked together so one consent covers upload, owner verification and Analytics. */
export const YOUTUBE_OAUTH_SCOPES = [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_SCOPE] as const;
