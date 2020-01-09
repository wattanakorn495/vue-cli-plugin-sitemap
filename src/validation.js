
/**
 * src/validation.js
 */

const AJV = require('ajv');

/**
 * Regex to check that the date follows the W3C format
 *
 * Acceptable formats:
 *    YYYY
 *    YYYY-MM
 *    YYYY-MM-DD
 *    YYYY-MM-DDThh:mmTZD
 *    YYYY-MM-DDThh:mm:ssTZD
 *    YYYY-MM-DDThh:mm:ss.sTZD
 *
 * where:
 *    YYYY = four-digit year
 *    MM   = two-digit month (01=January, etc.)
 *    DD   = two-digit day of month (01 through 31)
 *    hh   = two digits of hour (00 through 23) (am/pm NOT allowed)
 *    mm   = two digits of minute (00 through 59)
 *    ss   = two digits of second (00 through 59)
 *    s    = one or more digits representing a decimal fraction of a second
 *    TZD  = time zone designator (Z or +hh:mm or -hh:mm)
 */
const YYYY = '[12]\\d{3}';
const MM   = '(?:0[1-9]|1[0-2])';
const DD   = '(?:0[1-9]|[12]\\d|3[01])';
const hh   = '(?:[01]\\d|2[0-3])';
const mm   = '[0-5]\\d';
const ss   = '[0-5]\\d';
const s    = '\\d+';
const TZD  = `(?:Z|[+-]${hh}:${mm})`;
const W3CDatePattern = `^${YYYY}(?:-${MM}(?:-${DD}(?:T${hh}:${mm}(?::${ss}(?:\\.${s})?)?${TZD})?)?)?$`;

/**
 * Schemas
 * -----------------------------------------------------------------------------
 */

const URLMetaTagsSchema = {
	lastmod: {
		type:        ['object', 'string', 'number'],
		W3CDate:     true,
	},
	changefreq: {
		type:        'string',
		enum:        ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'],
	},
	priority: {
		type:        'number',
		multipleOf:  0.1,
		minimum:     0.0,
		maximum:     1.0,
	},
}

const slugsSchema = {
	type:  'array',
	items: {
		type: ['object', 'number', 'string'],

		properties: {
			slug: {
				type: ['number', 'string']
			},
			...URLMetaTagsSchema,
		},
		required:              ['slug'],
		additionalProperties:  false
	}
}

const routePropsSchema = {
	ignoreRoute: {
		type:    'boolean',
		default: false,
	},
	slugs: slugsSchema,
}

/**
 * Custom validation function for the 'W3CDate' keyword
 */
function validateW3CDate(_data, _dataPath, _parentData, _parentDataPropName)
{
	const errorBase = {
		keyword: 'W3CDate',
		params:  {},
	};

	// If the provided data is a Date object
	if (Object.prototype.toString.call(_data) === "[object Date]")
	{
		// Check the Date object is valid
		if (isNaN(_data.getTime()))
		{
			validateW3CDate.errors = [{
				...errorBase,
				message: 'the provided Date object is invalid'
			}];

			return false;
		}

		// Export the date in a W3C-approved format
		_parentData[_parentDataPropName] = _data.toISOString();

		return true;
	}

	// If the data is a string
	if (typeof _data == 'string')
	{
		// Check that it matches the W3C date format
		const W3CDateFormat = new RegExp(W3CDatePattern);
		if (W3CDateFormat.test(_data))
			return true;

		// Else, create a Date object with the data and validate it
		return validateW3CDate(new Date(_data), _dataPath, _parentData, _parentDataPropName);
	}

	// If the data is a numeric timestamp
	if (typeof _data == 'number')
	{
		// Create a Date object with the data and validate it
		return validateW3CDate(new Date(_data), _dataPath, _parentData, _parentDataPropName);
	}

	validateW3CDate.errors = [{
		...errorBase,
		message: 'date must either be a valid Date object, a string following the W3C date format or a valid numeric timestamp'
	}];

	return false;
}

/**
 * Validators
 * -----------------------------------------------------------------------------
 */

const ajv = new AJV({
	useDefaults:          true,
	multipleOfPrecision:  3,
});

// Add a keyword to validate the dates
ajv.addKeyword('W3CDate', {
	validate:  validateW3CDate,
	type:      ['object', 'string', 'number'],
	schema:    false,
	modifying: true,
});

// Compile the validators
const slugsValidator   = ajv.compile(slugsSchema);
const optionsValidator = ajv.compile({
	type: 'object',

	// Require at least on URL or one route
	anyOf: [
		{ properties: { urls:   { minItems: 1 } } },
		{ properties: { routes: { minItems: 1 } } },
	],

	// If some routes are passed, require the 'baseURL' property
	if:   { properties: { routes:  { minItems:  1 } } },
	then: { properties: { baseURL: { minLength: 1 } } },

	properties: {

		/**
		 * Global options
		 * -------------------------------------------------------------
		 */
		productionOnly: {
			type:     'boolean',
			default:  false,
		},
		baseURL: {
			type:     'string',
			default:  '',

			anyOf: [
				{
					minLength:  0,
					maxLength:  0,
				},
				{
					format:     'uri',
					pattern:    '\\.[a-z]+$',
				}
			]
		},
		trailingSlash: {
			type:     'boolean',
			default:  false,
		},
		pretty: {
			type:     'boolean',
			default:  false,
		},
		// Default URL meta tags
		defaults: {
			type:                  'object',
			properties:            URLMetaTagsSchema,
			additionalProperties:  false,
			default:               {},
		},

		/**
		 * Routes
		 * -------------------------------------------------------------
		 */
		routes: {
			type:    'array',
			default: [],

			items: {
				type: 'object',

				properties: {
					sitemap: {
						type: 'object',

						properties: {
							...routePropsSchema,
							...URLMetaTagsSchema
						},
						additionalProperties: false
					},
					...routePropsSchema,
					...URLMetaTagsSchema
				},
				required:              ['path'],
				additionalProperties:  true
			}
		},

		/**
		 * URLs
		 * -------------------------------------------------------------
		 */
		urls: {
			type:    'array',
			default: [],

			items: {
				type: 'object',

				properties: {
					loc: {
						type: 'string',

						// Set the validation schema of the URL location according to the 'baseURL' option:
						//  - if set, require the locations to be simple strings and NOT resembling URIs
						//  - if unset, require the locations to be full URIs
						if:    { properties: { baseURL: { minLength: 1 } } },
						then:  { properties: { urls: { items: { properties: {
						           loc: { not: { anyOf: [{ pattern: '^https?:\\/\\/' }, { pattern: '\\.' }] } }
						       } } } } },
						else:  { properties: { urls: { items: { properties: {
						           loc: { allOf: [{ format: 'uri' }, { pattern: '^https?:\\/\\/' }] }
						       } } } } },
					},
					...URLMetaTagsSchema
				},
				required:              ['loc'],
				additionalProperties:  false,
			}
		},
	},
	additionalProperties: false,
});

module.exports = {
	slugsValidator,
	optionsValidator,
}
