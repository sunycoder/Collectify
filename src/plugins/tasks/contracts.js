const { objectInput, entityId } = require('../../plugin-system/request-contract');
/** @type {import('../../plugin-system/request-contract').ActionContracts} */
module.exports = {
    state: {
        validateResult: (value) => {
            objectInput(value);
            if (!Array.isArray(value.tasks)) throw Error('待办列表无效');
        }
    },
    overlay: {},
    'pick-files': {},
    'pick-folder': {},
    'widget-open': {},
    'widget-auto-restore': {},
    settings: { write: true, validate: objectInput },
    'task-save': {
        write: true,
        validate: objectInput,
        validateResult: (value) => {
            objectInput(value);
            entityId(value.id);
        }
    },
    'task-delete': { write: true, validate: entityId },
    'task-remind': {
        write: true,
        validate: (input) => {
            objectInput(input);
            entityId(input.id);
            if (typeof input.remindAt !== 'string') throw Error('提醒时间无效');
        }
    },
    'unlink-bookmark': { write: true, validate: entityId },
    'open-file': {
        validate: (input) => {
            objectInput(input);
            entityId(input.id);
            if (!Number.isInteger(input.index) || input.index < 0 || input.index >= 20) throw Error('附件索引无效');
        }
    },
    'save-many': {
        write: true,
        validate: (input) => {
            if (!Array.isArray(input) || !input.length || input.length > 200) throw Error('批量待办参数无效');
            input.forEach(objectInput);
        }
    }
};
