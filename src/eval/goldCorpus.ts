export interface GoldCorpus {
    name: string;
    files: { filename: string; mimetype: string; content: string }[];
    goals: string[];
}

const LODASH_MD = `# lodash utilities

Install with \`npm install lodash\`.

## chunk

Use \`chunk(array, size)\` to split an array into groups. Returns a new array of arrays.

Parameters:

- \`array\` (array, required): the array to process.
- \`size\` (number, optional): the length of each chunk, defaults to 1.

\`\`\`js
import _ from "lodash";
console.log(_.chunk([1, 2, 3, 4, 5], 2));
// => [[1, 2], [3, 4], [5]]
\`\`\`

## groupBy

Use \`groupBy(collection, iteratee)\` to group elements by the result of the iteratee. Returns an object keyed by group.

Parameters:

- \`collection\` (array, required): the collection to iterate over.
- \`iteratee\` (function, optional): the function invoked per element; defaults to identity.

\`\`\`js
import _ from "lodash";
console.log(_.groupBy([6.1, 4.2, 6.3], Math.floor));
// => { "4": [4.2], "6": [6.1, 6.3] }
\`\`\`

## pick

Use \`pick(object, paths)\` to create an object composed of the picked properties.

Parameters:

- \`object\` (object, required): the source object.
- \`paths\` (array, required): the property paths to pick.

\`\`\`js
import _ from "lodash";
console.log(_.pick({ a: 1, b: 2, c: 3 }, ["a", "c"]));
// => { a: 1, c: 3 }
\`\`\`
`;

const DAYJS_MD = `# dayjs date handling

Install with \`npm install dayjs\`.

## format

Call \`.format(template)\` to render a date as text. Returns a string.

Parameters:

- \`template\` (string, optional): tokens such as \`YYYY-MM-DD\`; defaults to ISO 8601.

\`\`\`js
import dayjs from "dayjs";
console.log(dayjs("2020-01-15").format("YYYY/MM/DD"));
// => "2020/01/15"
\`\`\`

## diff

Call \`.diff(other, unit)\` to measure the difference between two dates. Returns a number.

Parameters:

- \`other\` (string, required): the date to compare against.
- \`unit\` (string, optional): e.g. \`day\`, \`month\`, \`year\`; defaults to milliseconds.
- \`float\` (boolean, optional): when true, returns a floating point result.

\`\`\`js
import dayjs from "dayjs";
console.log(dayjs("2020-01-25").diff("2020-01-15", "day"));
// => 10
\`\`\`

## add

Call \`.add(value, unit)\` to shift a date forward. Returns a new dayjs object.

Parameters:

- \`value\` (number, required): the amount to add.
- \`unit\` (string, required): e.g. \`day\`, \`week\`, \`month\`.

\`\`\`js
import dayjs from "dayjs";
console.log(dayjs("2020-01-15").add(7, "day").format("YYYY-MM-DD"));
// => "2020-01-22"
\`\`\`
`;

const UUID_MD = `# uuid identifiers

Install with \`npm install uuid\`.

## v4

Call \`v4()\` to generate a random UUID. Returns a string of 36 characters.

\`\`\`js
import { v4 } from "uuid";
const id = v4();
console.log(id.length);
// => 36
\`\`\`

## validate

Call \`validate(str)\` to test whether a string is a valid UUID. Returns a boolean.

Parameters:

- \`str\` (string, required): the string to test.

\`\`\`js
import { v4, validate } from "uuid";
console.log(validate(v4()), validate("not-a-uuid"));
// => true false
\`\`\`

## version

Call \`version(uuid)\` to read the version field of a valid UUID. Returns a number.

Parameters:

- \`uuid\` (string, required): a valid UUID string.

\`\`\`js
import { v4, version } from "uuid";
console.log(version(v4()));
// => 4
\`\`\`
`;

const SLUGIFY_MD = `# slugify strings

Install with \`npm install slugify\`.

## slugify

Call \`slugify(text, options)\` to turn a phrase into a URL-safe slug. Returns a string.

Parameters:

- \`text\` (string, required): the input phrase.
- \`replacement\` (string, optional): separator used instead of spaces, defaults to \`-\`.
- \`lower\` (boolean, optional): lowercase the result, defaults to false.
- \`strict\` (boolean, optional): strip characters outside the replacement set, defaults to false.

\`\`\`js
import slugify from "slugify";
console.log(slugify("Rookie System Test!", { lower: true, strict: true }));
// => "rookie-system-test"
\`\`\`
`;

const MS_MD = `# ms time conversion

Install with \`npm install ms\`.

## ms (parse)

Call \`ms(text)\` with a duration phrase to obtain milliseconds. Returns a number.

Parameters:

- \`text\` (string, required): a phrase such as \`"2 days"\`, \`"1h"\` or \`"5m"\`.

\`\`\`js
import ms from "ms";
console.log(ms("2 days"));
// => 172800000
\`\`\`

## ms (format)

Call \`ms(value, options)\` with a number to obtain a readable duration. Returns a string.

Parameters:

- \`value\` (number, required): duration in milliseconds.
- \`long\` (boolean, optional): use the verbose format such as \`"1 minute"\`.

\`\`\`js
import ms from "ms";
console.log(ms(60000), ms(60000, { long: true }));
// => "1m" "1 minute"
\`\`\`
`;

export const GOLD_CORPORA: GoldCorpus[] = [
    {
        name: "gold-multilib",
        files: [
            { filename: "lodash.md", mimetype: "text/markdown", content: LODASH_MD },
            { filename: "dayjs.md", mimetype: "text/markdown", content: DAYJS_MD },
            { filename: "uuid.md", mimetype: "text/markdown", content: UUID_MD },
            { filename: "slugify.md", mimetype: "text/markdown", content: SLUGIFY_MD },
            { filename: "ms.md", mimetype: "text/markdown", content: MS_MD },
        ],
        goals: [
            "Using the documented lodash functions, split [1,2,3,4,5,6,7] into chunks of 3 and print the result.",
            "Using the documented lodash functions, group the words ['one','two','three'] by their length and print the result.",
            "Using the documented dayjs API, compute how many days lie between 2020-01-01 and 2020-03-01 and print the number.",
            "Using the documented dayjs API, print the date 30 days after 2021-06-01 in YYYY-MM-DD format.",
            "Using the documented uuid API, generate a UUID, verify it is valid and print its version.",
            "Using the documented slugify API, convert 'Praca Magisterska 2026!' into a lowercase strict slug and print it.",
            "Using the documented ms API, convert '3 hours' to milliseconds and format 90000 ms as a verbose duration; print both.",
        ],
    },
];
