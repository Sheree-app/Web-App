-- Some existing environments created notification_kind before the social value
-- was introduced. The social trigger must be able to cast its value or the
-- originating like, save, or comment transaction is rolled back.
alter type public.notification_kind add value if not exists 'social';
