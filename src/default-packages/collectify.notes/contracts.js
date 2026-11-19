const { entityId, objectInput } = require('../../plugin-system/request-contract');
/** @type {import('../../plugin-system/request-contract').ActionContracts} */
module.exports = {
    state: {
        validateResult: (value) => {
            objectInput(value);
            if (!Array.isArray(value.notes)) throw Error('便签列表无效');
        }
    },
    overlay: {},
    'note-save': {
        write: true,
        validate: objectInput,
        validateResult: (value) => {
            objectInput(value);
            entityId(value.id);
        }
    },
    'note-delete': { write: true, validate: entityId },
    'to-task': { validate: entityId },
    'note-sort': {
        write: true,
        validate: (value) => {
            if (!['manual', 'updated'].includes(value)) throw Error('排序方式无效');
        }
    },
    'note-move': {
        write: true,
        validate: (input) => {
            objectInput(input);
            entityId(input.id);
            entityId(input.before);
        }
    }
};
