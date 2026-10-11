-- MT-5d.foreign_key: a quality table with a foreign key to an integrity table.
create table integrity.mt_5d_signal (signal_id uuid primary key, band text);
create table quality.mt_5d_score (
  session_id uuid,
  points int,
  signal_id uuid references integrity.mt_5d_signal (signal_id)
);
