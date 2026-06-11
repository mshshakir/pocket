/// Cloud sync configuration.
///
/// Fill these three values in, then restart the app — it will switch from the
/// built-in sample data to your real PowerSync-synced data automatically.
/// While any of them is blank, the app runs offline on sample data.
///
///  - supabaseUrl / supabaseAnonKey: Supabase Dashboard → Project Settings → API
///  - powerSyncUrl:                  PowerSync Dashboard → your instance URL
///                                   (looks like https://<id>.powersync.journeyapps.com)
const String supabaseUrl = 'https://csftaatwjldwjxuylqtn.supabase.co';
const String supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzZnRhYXR3amxkd2p4dXlscXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MDkzMzAsImV4cCI6MjA5NjM4NTMzMH0.0F0n7-d3vuIN32R_A6SUEh5mRP4VHimzEXVYefeTvQ4';
const String powerSyncUrl = 'https://6a251b720ef84ed6719fa4e8.powersync.journeyapps.com';

/// True only when all three values are set.
bool get syncConfigured =>
    supabaseUrl.isNotEmpty &&
    supabaseAnonKey.isNotEmpty &&
    powerSyncUrl.isNotEmpty;
