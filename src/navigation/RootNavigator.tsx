import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator } from 'react-native';
import { colors } from '../theme/theme';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { AuthScreen } from '../screens/AuthScreen';
import { CustomerSwipeScreen } from '../screens/CustomerSwipeScreen';
import { ModelProfileScreen } from '../screens/ModelProfileScreen';
import { AgencyDashboardScreen } from '../screens/AgencyDashboardScreen';
import { NotificationBell } from '../components/NotificationBell';

type AuthStackParamList = {
  Auth: undefined;
};

type AppTabParamList = {
  Swipe: undefined;
  Model: undefined;
  Agency: undefined;
};

export type UserRole = 'client' | 'model' | 'agency';

const Stack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<AppTabParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    border: colors.border,
  },
};

function MinimalTabBarLabel({ title }: { title: string }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <Text
        style={{
          fontSize: 11,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: colors.textSecondary,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

type AppTabsProps = {
  role: UserRole;
};

function AppTabs({ role }: AppTabsProps) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitle: '',
        headerRight: () => <NotificationBell />,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          elevation: 0,
        },
        // RN Navigation v7: kein tabBarShowIcon — ohne tabBarIcon werden keine Icons gezeigt.
        tabBarLabelPosition: 'below-icon',
      }}
    >
      {role === 'client' && (
        <Tab.Screen
          name="Swipe"
          component={CustomerSwipeScreen}
          options={{
            tabBarLabel: () => <MinimalTabBarLabel title="The Swipe" />,
          }}
        />
      )}

      {role === 'model' && (
        <Tab.Screen
          name="Model"
          component={ModelProfileScreen}
          options={{
            tabBarLabel: () => <MinimalTabBarLabel title="Model" />,
          }}
        />
      )}

      {role === 'agency' && (
        <Tab.Screen
          name="Agency"
          component={AgencyDashboardScreen}
          options={{
            tabBarLabel: () => <MinimalTabBarLabel title="Agency" />,
          }}
        />
      )}
    </Tab.Navigator>
  );
}

function RootNavigatorInner() {
  const { session, profile, loading } = useAuth();

  const isAuthenticated = !!session && !!profile;
  const role: UserRole | null =
    profile?.role === 'model'
      ? 'model'
      : profile?.role === 'agent'
      ? 'agency'
      : profile?.role === 'client'
      ? 'client'
      : null;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {isAuthenticated && role ? (
        <AppTabs role={role} />
      ) : (
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="Auth">
            {() => <AuthScreen />}
          </Stack.Screen>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

/**
 * Standalone navigator — must be rendered inside <AuthProvider>.
 * The production app uses App.tsx which already wraps everything in AuthProvider.
 */
export function RootNavigator() {
  return (
    <AuthProvider>
      <RootNavigatorInner />
    </AuthProvider>
  );
}

