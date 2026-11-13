module.exports = {
    id: 'collectify.bookmarks',
    schema: "CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, description TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;\r\nCREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED, type TEXT NOT NULL CHECK(type IN ('web','file','folder','text','credential')), name TEXT NOT NULL, url TEXT NOT NULL, local_path TEXT NOT NULL, content TEXT NOT NULL, environment TEXT NOT NULL, note TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK(auth_mode IN ('manual','basic')), open_mode TEXT NOT NULL CHECK(open_mode IN ('internal','external')), favorite INTEGER NOT NULL CHECK(favorite IN (0,1)), last_opened INTEGER NOT NULL CHECK(last_opened>=0), sort_order INTEGER NOT NULL) STRICT;\r",
    tables: {
        categories: {
            fields: {
                id: 'id',
                name: 'name',
                description: 'description',
                color: 'color',
                icon: 'icon'
            },
            nameKey: true
        },
        entries: {
            fields: {
                id: 'id',
                categoryId: 'category_id',
                type: 'type',
                name: 'name',
                url: 'url',
                localPath: 'local_path',
                content: 'content',
                environment: 'environment',
                note: 'note',
                username: 'username',
                password: 'password',
                authMode: 'auth_mode',
                mode: 'open_mode',
                favorite: 'favorite',
                lastOpened: 'last_opened'
            },
            booleans: ['favorite']
        }
    },
    attachments: false
};
