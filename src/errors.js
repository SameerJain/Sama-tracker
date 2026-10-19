// a request to start.gg or slippi that failed, as opposed to a bug or discord saying no, so the reply can
// name who's at fault. status is the HTTP status when there was one, null when nothing answered
export class ApiError extends Error {
  constructor(source, message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.source = source;
    this.status = status;
  }
}
