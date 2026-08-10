import { ValidationError } from "../errors/index.js";

function formatZodIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
    value: issue.input,
  }));
}

/**
 * Validate request data with a Zod schema.
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new ValidationError(formatZodIssues(result.error.issues)));
    }
    req[source] = result.data;
    return next();
  };
}

export const validateBody = (schema) => validate(schema, "body");
export const validateQuery = (schema) => validate(schema, "query");
export const validateParams = (schema) => validate(schema, "params");
