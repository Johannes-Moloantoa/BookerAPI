/* Minimal serverless-friendly handler for booking HubSpot custom object appointments */

const DEFAULT_MEETING_PROP = process.env.HUBSPOT_MEETING_PROP || "meeting";
const DEFAULT_LANGUAGES_PROP = "languages"; // hardcoded per request
const OBJECT_TYPE = "2-50779282"; // HubSpot custom object type id (hardcoded by request)

function getAccessToken() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Missing HubSpot token. Set HUBSPOT_ACCESS_TOKEN in env.");
  }
  return token;
}

function buildAuthHeaders() {
  const token = getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function searchAppointment(meeting, languagesCsv) {
  const url = `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(OBJECT_TYPE)}/search`;
  const filters = [];
  if (meeting) {
    filters.push({ propertyName: DEFAULT_MEETING_PROP, operator: "EQ", value: meeting });
  }
  if (languagesCsv) {
    filters.push({ propertyName: DEFAULT_LANGUAGES_PROP, operator: "EQ", value: languagesCsv });
  }
  const body = {
    filterGroups: filters.length ? [{ filters }] : [],
    properties: [DEFAULT_MEETING_PROP, DEFAULT_LANGUAGES_PROP],
    limit: 10
  };
  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && data.message ? data.message : `HubSpot search failed with ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function createAppointment(meeting, languagesCsv) {
  // Fetch schema to learn required properties
  const schemaUrl = `https://api.hubapi.com/crm/v3/schemas/${encodeURIComponent(OBJECT_TYPE)}`;
  const schemaRes = await fetch(schemaUrl, { headers: buildAuthHeaders() });
  let requiredProps = [];
  let primaryProperty = null;
  let propertyDefs = {};
  let meetingPropName = DEFAULT_MEETING_PROP;
  let languagesPropName = DEFAULT_LANGUAGES_PROP;
  if (schemaRes.ok) {
    const schema = await schemaRes.json();
    requiredProps = Array.isArray(schema.requiredProperties) ? schema.requiredProperties : [];
    primaryProperty = schema.primaryDisplayProperty || null;
    if (Array.isArray(schema.properties)) {
      for (const p of schema.properties) {
        propertyDefs[p.name] = p;
      }

      // Resolve meeting property: prefer explicit, else a date/datetime property
      if (!propertyDefs[meetingPropName]) {
        const candidates = schema.properties.filter(p => {
          const isDate = (p.type === 'date' || p.type === 'datetime');
          const isReadOnly = p.readOnlyValue === true || p.readOnlyDefinition === true || (p.modificationMetadata && p.modificationMetadata.readOnly === true);
          const isSystemCreatedDate = String(p.name).toLowerCase() === 'hs_createdate' || String(p.name).toLowerCase().includes('createdate');
          return isDate && !isReadOnly && !isSystemCreatedDate;
        });
        // try those that include 'meeting' in the name first
        const withMeeting = candidates.find(p => String(p.name).toLowerCase().includes('meeting'));
        meetingPropName = withMeeting ? withMeeting.name : (candidates[0] ? candidates[0].name : meetingPropName);
      }

      // Resolve languages property: prefer explicit, else a single-select with options
      if (!propertyDefs[languagesPropName]) {
        const candidates = schema.properties.filter(p => {
          const isSelect = Array.isArray(p.options) && p.options.length;
          const isReadOnly = p.readOnlyValue === true || p.readOnlyDefinition === true || (p.modificationMetadata && p.modificationMetadata.readOnly === true);
          return isSelect && !isReadOnly;
        });
        const withLang = candidates.find(p => String(p.name).toLowerCase().includes('language'));
        languagesPropName = withLang ? withLang.name : (candidates[0] ? candidates[0].name : languagesPropName);
      }
    }
  }

  const url = `https://api.hubapi.com/crm/v3/objects/${encodeURIComponent(OBJECT_TYPE)}`;
  const props = {
    [meetingPropName]: meeting,
    [languagesPropName]: languagesCsv
  };

  // Ensure a display name if present
  if (primaryProperty && !props[primaryProperty]) {
    props[primaryProperty] = `Healer appointment ${meeting} - ${languagesCsv}`;
  }

  // Normalize languages to a valid option if property is single-select
  const langDef = propertyDefs[languagesPropName];
  if (langDef && Array.isArray(langDef.options) && langDef.options.length) {
    const provided = (languagesCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    const optionValues = new Set(langDef.options.map(o => String(o.value ?? o.label)));
    const firstValid = provided.find(v => optionValues.has(v));
    props[languagesPropName] = firstValid || (langDef.options[0].value ?? langDef.options[0].label);
  }

  // Fill any other required properties with safe defaults
  for (const propName of requiredProps) {
    if (props[propName] != null && props[propName] !== "") continue;
    const def = propertyDefs[propName] || {};
    const isReadOnly = def.readOnlyValue === true || def.readOnlyDefinition === true || (def.modificationMetadata && def.modificationMetadata.readOnly === true);
    if (isReadOnly) {
      continue;
    }
    const type = def.type || def.fieldType || "string";
    let value = "Auto";
    if (def.options && Array.isArray(def.options) && def.options.length) {
      value = def.options[0].value ?? def.options[0].label ?? "Auto";
    } else if (type === "number") {
      value = 0;
    } else if (type === "bool" || type === "boolean") {
      value = false;
    } else if (type === "date") {
      // HubSpot date properties typically expect ms since epoch
      const dt = new Date(meeting || Date.now());
      value = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    } else if (type === "datetime") {
      value = Date.now();
    } else {
      value = `Auto-${meeting}`;
    }
    props[propName] = value;
  }

  const body = { properties: props };
  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data && data.message ? data.message : `HubSpot create failed with ${res.status}`;
    throw new Error(message);
  }
  return data;
}

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return jsonResponse(204, {});
  }

  try {
    let meeting = "";
    let languages = "";

    if (request.method === "GET") {
      const url = new URL(request.url);
      meeting = url.searchParams.get("meeting") || "";
      languages = url.searchParams.get("languages") || "";
    } else if (request.method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await request.json();
        meeting = body.meeting || "";
        languages = body.languages || "";
      } else {
        const form = await request.formData();
        meeting = form.get("meeting") || "";
        languages = form.get("languages") || "";
      }
    } else {
      return jsonResponse(405, { status: "error", message: "Method not allowed" });
    }

    if (!meeting || !isIsoDate(meeting)) {
      return jsonResponse(400, { status: "error", message: "Invalid or missing 'meeting' (YYYY-MM-DD)" });
    }
    if (!languages || typeof languages !== "string") {
      return jsonResponse(400, { status: "error", message: "Invalid or missing 'languages' (comma-separated string)" });
    }

    if (request.method === "GET") {
      const found = await searchAppointment(meeting, languages);
      return jsonResponse(200, { status: "success", message: "Fetched appointments", data: found });
    }

    // Only GET is supported now
    return jsonResponse(405, { status: "error", message: "Only GET is supported for this endpoint" });
  } catch (err) {
    const message = err && err.message ? err.message : "Unknown error";
    return jsonResponse(500, { status: "error", message });
  }
}

/* Vercel Edge Runtime export */
export const config = { runtime: "edge" };
export default async function handler(request) {
  return handleRequest(request);
}


