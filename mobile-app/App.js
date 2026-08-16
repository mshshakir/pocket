/**
 * App — navigation shell over the shared domain layer.
 *
 * Tabs: Dashboard · Transactions · Accounts · Budgets · More
 * More routes to: Debts, Reports, Categories, Regular items, Family, Settings.
 * Modals: TransactionForm, CategoryPicker (the two-step picker).
 */
import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppProvider, useAppReady } from './src/state/AppContext.js';
import DashboardScreen from './src/screens/DashboardScreen.js';
import TransactionsScreen from './src/screens/TransactionsScreen.js';
import AccountsScreen from './src/screens/AccountsScreen.js';
import BudgetsScreen from './src/screens/BudgetsScreen.js';
import MoreScreen from './src/screens/MoreScreen.js';
import SettingsScreen from './src/screens/SettingsScreen.js';
import TransactionFormScreen from './src/screens/TransactionFormScreen.js';
import CategoryPickerScreen from './src/screens/CategoryPickerScreen.js';
import AccountPickerScreen from './src/screens/AccountPickerScreen.js';
import DebtsScreen from './src/screens/DebtsScreen.js';
import ReportsScreen from './src/screens/ReportsScreen.js';
import CategoriesScreen from './src/screens/CategoriesScreen.js';
import RegularsScreen from './src/screens/RegularsScreen.js';
import FamilyScreen from './src/screens/FamilyScreen.js';
import { colors } from './src/ui/theme.js';
import { SpaceBar } from './src/ui/SpaceBar.js';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Dashboard: '◈', Transactions: '⇅', Accounts: '▤', Budgets: '◔', More: '⋯',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarIcon: ({ color }) => (
          <Text style={{ fontSize: 16, color }}>{TAB_ICONS[route.name] || '·'}</Text>
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Accounts" component={AccountsScreen} />
      <Tab.Screen name="Budgets" component={BudgetsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

/** Screens reachable from More — plain stack pushes, with headers. */
const STACK_SCREENS = [
  ['Debts', DebtsScreen, 'Debts'],
  ['Reports', ReportsScreen, 'Reports'],
  ['Categories', CategoriesScreen, 'Categories'],
  ['Regulars', RegularsScreen, 'Regular items'],
  ['Family', FamilyScreen, 'Family sharing'],
  ['Settings', SettingsScreen, 'Settings'],
];

function Root() {
  const ready = useAppReady();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={{ marginTop: 12, color: colors.subtle }}>Opening your book…</Text>
      </View>
    );
  }
  return (
    <NavigationContainer>
      {/* One mount, above both header systems, so the space context is visible
          on every tab and every pushed screen. Renders null unless someone
          actually shares with you. */}
      <SpaceBar />
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        {STACK_SCREENS.map(([name, component, title]) => (
          <Stack.Screen key={name} name={name} component={component} options={{ title }} />
        ))}
        <Stack.Screen
          name="TransactionForm"
          component={TransactionFormScreen}
          options={({ route }) => ({
            presentation: 'modal',
            title: route.params?.id ? 'Edit transaction' : 'New transaction',
          })}
        />
        <Stack.Screen
          name="CategoryPicker"
          component={CategoryPickerScreen}
          options={{ presentation: 'modal', title: 'Choose category' }}
        />
        <Stack.Screen
          name="AccountPicker"
          component={AccountPickerScreen}
          options={{ presentation: 'modal', title: 'Choose account' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AppProvider>
      <StatusBar style="auto" />
      <Root />
    </AppProvider>
  );
}
