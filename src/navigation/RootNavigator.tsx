import React, { useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text } from 'react-native';
import { colors } from '../theme/theme';
import { LoginScreen } from '../screens/LoginScreen';
import { CustomerSwipeScreen } from '../screens/CustomerSwipeScreen';
import { ModelProfileScreen } from '../screens/ModelProfileScreen';
import { AgencyDashboardScreen } from '../screens/AgencyDashboardScreen';

type AuthStackParamList = {
  Login: undefined;
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
        headerShown: false,
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

export function RootNavigator() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);

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
          <Stack.Screen name="Login">
            {(props) => (
              <LoginScreen
                {...props}
                onSelectRole={(selectedRole) => {
                  setRole(selectedRole);
                  setIsAuthenticated(true);
                }}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

